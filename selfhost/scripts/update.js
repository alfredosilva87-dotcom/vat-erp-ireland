"use strict";
/**
 * Actualizar uma instalacao self-hosted, sem perder dados.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM E O ASSUNTO
 *
 * Cada passo so corre depois de o anterior ter dado certo, e o BACKUP vem
 * primeiro de todos. Uma actualizacao que corre pela metade num sistema
 * contabil nao e um incomodo — e a base de dados de um escritorio no meio de
 * uma migracao de esquema, sem volta atras.
 *
 *   1. backup            — antes de tocar em nada
 *   2. guardar onde estou — o commit actual, para poder voltar
 *   3. git pull          — recusa se houver alteracoes locais por gravar
 *   4. npm install       — dependencias novas
 *   5. esquema           — os .sql sao idempotentes e correm TODOS, sempre
 *   6. build             — se falhar aqui, volta-se ao commit guardado
 *
 * O passo 5 nao precisa de registo de migracoes aplicadas porque cada ficheiro
 * de `selfhost/schema/` e escrito para poder correr de novo sem estragar nada
 * (`create table if not exists`, `create or replace`, `drop trigger if
 * exists`). E o que ja fazia o instalador desde o inicio.
 */
const fs = require("fs");
const path = require("path");

const {
  ROOT, bold, dim, cyan, yellow,
  step, ok, warn, fail, npmRun, capture, run,
} = require("./lib/proc");

function git(args, opts = {}) {
  return capture("git", args, { cwd: ROOT, ...opts });
}

function banner() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  console.log(`
${bold("VAT ERP Ireland — actualizacao")}
${dim(`Versao instalada: ${pkg.version}`)}
`);
  return pkg.version;
}

function main() {
  const versaoAntes = banner();

  // ------------------------------------------------------- 0. isto e um clone?
  if (!fs.existsSync(path.join(ROOT, ".git"))) {
    fail("Esta instalacao nao foi feita por `git clone`, entao nao ha de onde puxar.");
    console.log(dim("  Peca uma copia nova e reinstale, ou clone o repositorio por cima."));
    process.exit(1);
  }

  /*
   * ALTERACOES LOCAIS param tudo, ANTES do backup.
   *
   * Um `git pull` por cima de trabalho por gravar ou da um conflito a meio (e
   * a instalacao fica num estado que ninguem sabe descrever) ou apaga o que la
   * estava. Nenhum dos dois pode acontecer sem alguem decidir.
   *
   * Acontece a serio: alguem edita o `.env.local` ou mexe num ficheiro para
   * testar, e esquece-se.
   */
  step("Vendo se ha alteracoes locais por gravar");
  const sujo = git(["status", "--porcelain"]).stdout.trim();
  if (sujo) {
    fail("Ha ficheiros alterados nesta instalacao:");
    console.log(sujo.split("\n").slice(0, 20).map((l) => "    " + l).join("\n"));
    console.log(dim("\n  Guarde ou desfaca essas alteracoes antes de actualizar."));
    console.log(dim("  Se forem de proposito: `git stash push -u -m antes-da-atualizacao`"));
    process.exit(1);
  }
  ok("Arvore limpa");

  // ------------------------------------------------------------- 1. backup
  /*
   * O backup corre como PROCESSO FILHO, e nao por `require`.
   *
   * `backup.js` chama `main()` ao ser carregado e sai com `process.exit` quando
   * falha — num `require` isso levava esta actualizacao com ele, a meio, sem
   * passar por nenhum dos tratamentos abaixo. Como filho, o codigo de saida
   * dele e so mais um numero que se le.
   */
  step("Copia de seguranca da base de dados");
  const bk = run(process.execPath, [path.join(__dirname, "backup.js")], { cwd: ROOT });
  if (bk.status !== 0) {
    fail("O backup falhou.");
    console.log(dim("  A actualizacao para aqui. Nada foi alterado."));
    process.exit(1);
  }
  ok("Backup feito");

  // --------------------------------------------------- 2. onde estou agora
  const commitAntes = git(["rev-parse", "HEAD"]).stdout.trim();
  console.log(dim(`    Commit actual: ${commitAntes.slice(0, 8)} (para voltar, se preciso)`));

  // ------------------------------------------------------------ 3. git pull
  step("Buscando a versao nova");
  const pull = git(["pull", "--ff-only"]);
  if (pull.status !== 0) {
    fail("O `git pull` falhou.");
    console.log(dim((pull.stderr || pull.stdout || "").split("\n").map((l) => "    " + l).join("\n")));
    console.log(dim("\n  Repositorio privado? Confirme que esta maquina tem credencial de leitura."));
    process.exit(1);
  }
  const commitDepois = git(["rev-parse", "HEAD"]).stdout.trim();
  if (commitAntes === commitDepois) {
    ok("Ja estava na versao mais recente. Nada a fazer.");
    process.exit(0);
  }

  const pkgDepois = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  ok(`${versaoAntes} -> ${pkgDepois.version}`);

  // Se algo abaixo falhar, e para aqui que se volta.
  const voltar = () => {
    warn("A desfazer: a voltar ao commit anterior.");
    git(["reset", "--hard", commitAntes]);
    npmRun(["install"]);
    console.log(dim("  A base de dados NAO foi tocada por este passo, e ha backup."));
  };

  // -------------------------------------------------------- 4. dependencias
  step("Instalando dependencias");
  const inst = npmRun(["install"]);
  if (inst.status !== 0) { fail("`npm install` falhou."); voltar(); process.exit(1); }
  ok("Dependencias em dia");

  // ------------------------------------------------------------- 5. esquema
  /*
   * Corre TODOS os ficheiros de esquema, e nao so os novos.
   *
   * Sao idempotentes por escrita, e correr tudo e o que garante que uma
   * instalacao que saltou tres versoes fica igual a uma que actualizou uma a
   * uma. Escolher "so os novos" exigiria um registo de aplicadas — mais uma
   * coisa para ficar dessincronizada, e a maneira classica de uma instalacao
   * ficar com meio esquema.
   */
  step("Aplicando o esquema da base de dados");
  const { applySchema } = require("./lib/setup");
  Promise.resolve(applySchema())
    .then(() => {
      ok("Esquema em dia");

      // ----------------------------------------------------------- 6. build
      step("Compilando a aplicacao");
      const build = npmRun(["run", "build"]);
      if (build.status !== 0) {
        fail("O build falhou.");
        voltar();
        console.log(dim("  Volte a arrancar com `selfhost/start` — fica na versao anterior."));
        process.exit(1);
      }
      ok("Compilado");

      console.log(`
${bold(cyan(`Actualizado: ${versaoAntes} -> ${pkgDepois.version}`))}

  ${yellow("Falta reiniciar:")}  selfhost/stop  e depois  selfhost/start
  ${dim("O que mudou em cada versao esta no HANDOFF.md.")}
`);
    })
    .catch((e) => {
      fail(`O esquema falhou: ${e.message}`);
      console.log(dim("  O codigo foi actualizado mas a base nao. NAO arranque assim."));
      console.log(dim("  Corra `selfhost/update` outra vez, ou restaure o backup."));
      process.exit(1);
    });
}

main();
