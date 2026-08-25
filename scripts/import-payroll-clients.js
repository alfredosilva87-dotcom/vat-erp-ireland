/**
 * Traz as empresas do Payroll Control do Matheus para o cadastro do ERP.
 *
 * Uso:  node scripts/import-payroll-clients.js [caminho/para/clients.json]
 *       (sem argumento, procura em ~/Downloads/payroll-web/db/clients.json)
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UM SCRIPT, E NÃO UM SEED VERSIONADO
 *
 * A lista tem nome de empresa, pessoa de contacto, e-mail e telemóvel de
 * clientes REAIS do escritório. O repositório do VAT Reader é público. Um seed
 * commitado publicaria a carteira de clientes de vocês, e o histórico do git
 * guarda para sempre — apagar num commit seguinte não desfaz.
 *
 * Por isso o dado não entra no repo em ficheiro nenhum: este script lê o
 * original na pasta onde ele já está e escreve direto no Postgres local. O
 * código pode ser commitado à vontade; o que ele carrega, não.
 *
 * Ver a memória `vat-erp-limpar-clientes-antes-do-commit`: quando o módulo for
 * commitado, os dois cadastros são esvaziados ANTES do `git add`.
 * ---------------------------------------------------------------------------
 *
 * Só roda contra localhost — a checagem abaixo recusa qualquer outra coisa.
 * É a mesma guarda de scripts/reset-test-data.js, e pelo mesmo motivo: um
 * script de dados de teste apontado por engano para produção é um estrago que
 * não tem desfazer.
 *
 * Executar duas vezes não duplica: casa pelo `client_code` e atualiza.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const PADRAO = path.join(os.homedir(), "Downloads", "payroll-web", "db", "clients.json");

/**
 * O `frequency` do ficheiro dele é um valor único ("Weekly"). No ERP os tipos
 * são independentes — uma casa pode rodar semanal e mensal ao mesmo tempo —
 * então o valor único vira a flag correspondente, e as outras ficam desligadas.
 */
function flagsDaFrequencia(freq) {
  const f = String(freq || "").toLowerCase();
  return {
    freq_weekly: f === "weekly",
    freq_fortnightly: f === "fortnightly",
    freq_monthly: f === "monthly",
  };
}
const tipoDe = (freq) => {
  const f = String(freq || "").toLowerCase();
  return ["weekly", "fortnightly", "monthly"].includes(f) ? f : null;
};

(async function main() {
  const origem = process.argv[2] || PADRAO;
  if (!fs.existsSync(origem)) {
    console.error(`Não achei o ficheiro: ${origem}`);
    console.error("Passe o caminho: node scripts/import-payroll-clients.js /caminho/clients.json");
    process.exit(1);
  }

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local"); process.exit(1); }
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error(`RECUSADO: isto só roda contra localhost, e o .env.local aponta para ${url}`);
    process.exit(1);
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // A empresa (tenant) a que estes clientes pertencem. Sem isto eles ficariam
  // sem escopo e invisíveis para lib/access.ts.
  const { data: comp } = await sb.from("companies").select("id,slug").eq("slug", "precisetax").maybeSingle();
  if (!comp) { console.error("Não achei a empresa 'precisetax' — rode o seed do ERP primeiro."); process.exit(1); }

  const linhas = JSON.parse(fs.readFileSync(origem, "utf8"));
  console.log(`${linhas.length} empresas em ${origem}`);

  let novos = 0, atualizados = 0, semFolha = 0;

  for (const r of linhas) {
    const code = String(r.code || "").trim();
    if (!code) continue;

    // ---- 1. o cadastro raiz ----
    const cadastro = {
      client_code: code,
      name: String(r.name || "").trim() || "Sem nome",
      status: "Active",
      contact_person: r.contact_person || null,
      email: r.email || null,
      phone: r.phone || null,
      company_id: comp.id,
      // O ERP exige atividade para as regras de crédito de VAT; estas empresas
      // vieram de um sistema que não tem esse conceito, então entram como
      // genéricas e quem souber ajusta na tela.
      activity_code: "GENERIC",
      activity_label: "Generic business",
    };

    const { data: existente } = await sb
      .from("clients").select("id").eq("client_code", code).eq("company_id", comp.id).maybeSingle();

    let clientId;
    if (existente) {
      await sb.from("clients").update(cadastro).eq("id", existente.id);
      clientId = existente.id;
      atualizados++;
    } else {
      const { data, error } = await sb.from("clients").insert(cadastro).select("id").single();
      if (error) { console.error(`  ${code} ${cadastro.name}: ${error.message}`); continue; }
      clientId = data.id;
      novos++;
    }

    // ---- 2. a configuração de folha ----
    // Cliente que não faz payroll não ganha linha em hr_client, e é assim que
    // ele simplesmente não aparece no controlo semanal.
    if (!r.svc_payroll) { semFolha++; continue; }

    await sb.from("hr_client").upsert({
      client_id: clientId,
      ...flagsDaFrequencia(r.frequency),
      pay_period: r.pay_period || null,
      pay_day: r.pay_day || null,
      week_base: r.week_base || null,
      hours_source: r.hours_source || null,
      reporting_channel: r.reporting_channel || null,
      auto_submit: !!r.auto_submit,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" });

    const tipo = tipoDe(r.frequency);
    if (tipo) {
      /*
       * `tracked_week` = a semana em que o tipo entra no sistema.
       *
       * Fica na semana ISO de HOJE de propósito. Pôr 1 faria cada empresa
       * nascer devendo o ano inteiro de payslips que na verdade saíram por
       * fora, pelo sistema antigo — e o painel abriria com 35 empresas em
       * atraso no primeiro dia de uso.
       */
      const hoje = new Date();
      const t = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()));
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
      const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      jan4.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + 3);
      const semana = 1 + Math.round((t - jan4) / (7 * 86400000));

      await sb.from("hr_client_config").upsert({
        client_id: clientId,
        freq_type: tipo,
        issue_day: r.pay_day || null,
        pay_period: r.pay_period || null,
        week_base: r.week_base || null,
        data_source: r.hours_source || null,
        week_offset: 0,
        tracked_year: t.getUTCFullYear(),
        tracked_week: semana,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id,freq_type" });
    }
  }

  console.log(`\n${novos} criados · ${atualizados} atualizados · ${semFolha} sem folha (só no cadastro)`);
  console.log("Lembrete: estes são clientes REAIS. Esvaziar os dois cadastros antes de commitar.");
})();
