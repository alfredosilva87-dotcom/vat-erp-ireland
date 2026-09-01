/**
 * O que faz de um ajuste um lançamento válido — sem banco, para poder ser testado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AJUSTAR NÃO É EDITAR
 *
 * Pedido do Alfredo (2026-09-01): "poderia ser possível alterar os lançamentos
 * contábeis dos docs, para ajustes e não perder o rastro, não só fazer via
 * lançamento manual".
 *
 * O que ele quer é o resultado: a partida daquele documento passa a estar
 * certa. O que NÃO se pode fazer para lá chegar é um `update` nas linhas — um
 * lançamento reescrito por cima não deixa rasto nenhum, e "não perder o rastro"
 * era metade do pedido.
 *
 * Então ajustar é **estornar e relançar**: o original fica, nasce o espelho que
 * o anula, e nasce a correcção — os três presos ao mesmo documento, para que
 * abrir o razão recortado nele conte a história inteira em três linhas.
 *
 * É também a única forma que funciona em período fechado, onde reescrever é
 * proibido e anular-e-refazer é o procedimento normal.
 */

export type LinhaDoAjuste = {
  account_code: string;
  debit: number;
  credit: number;
  description?: string | null;
};

export type Critica = { ok: true; linhas: LinhaDoAjuste[] } | { ok: false; erro: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Valida e normaliza as linhas que vieram da tela.
 *
 * `contasValidas` são os códigos que existem no plano, estão activos e são
 * analíticos. Passar `null` desliga essa verificação — serve o teste, não a
 * rota: uma conta sintética ou inactiva no razão faz a linha ser DESCARTADA do
 * balancete pelo `left join` do `trial_balance`, e o balanço deixa de fechar
 * sem causa apontável. É o erro que a Verificação já apanha depois; aqui
 * impede-se antes.
 */
export function criticarAjuste(
  entrada: LinhaDoAjuste[], contasValidas: Set<string> | null
): Critica {
  const linhas: LinhaDoAjuste[] = [];

  for (const [i, l] of entrada.entries()) {
    const conta = String(l.account_code ?? "").trim();
    const bruto = { d: r2(Number(l.debit) || 0), c: r2(Number(l.credit) || 0) };

    /*
     * A LINHA VAZIA sai primeiro, antes de qualquer exigência.
     *
     * A tela cresce sozinha e tem sempre uma linha em branco no fim, para dar
     * para acrescentar sem carregar em nada — e alguém pode escolher uma conta
     * e mudar de ideias antes de escrever o valor. Nenhum dos dois é erro.
     *
     * A ordem importava e estava trocada: `falta a conta` disparava antes de se
     * chegar ao descarte, e a linha em branco do fim recusava o lançamento
     * inteiro. Só é erro a linha que tem VALOR e não tem conta — essa é dinheiro
     * sem destino, e é a que se recusa mais abaixo.
     */
    if (!conta && !bruto.d && !bruto.c) continue;

    if (!conta) return { ok: false, erro: `Linha ${i + 1}: falta a conta.` };
    if (contasValidas && !contasValidas.has(conta)) {
      return {
        ok: false,
        erro: `Linha ${i + 1}: a conta ${conta} não existe no plano, está inactiva ou é sintética. `
          + "Lançar nela faria a linha sair do balancete em silêncio.",
      };
    }

    const { d, c } = bruto;
    if (d < 0 || c < 0) return { ok: false, erro: `Linha ${i + 1}: valor negativo. Troque o lado em vez do sinal.` };
    /*
     * Débito E crédito na mesma linha é sempre engano de digitação, e o
     * resultado dele é uma linha que balanceia sozinha e não faz nada — a
     * espécie de lixo que só se descobre meses depois a tentar perceber porque
     * é que o razão tem uma linha de zero.
     */
    if (d > 0 && c > 0) return { ok: false, erro: `Linha ${i + 1}: escolha débito OU crédito, não os dois.` };
    // Conta escolhida e valor por escrever: mudou de ideias, não é erro.
    if (d === 0 && c === 0) continue;

    linhas.push({ account_code: conta, debit: d, credit: c, description: l.description?.trim() || null });
  }

  if (linhas.length < 2) {
    return { ok: false, erro: "Um lançamento precisa de pelo menos duas linhas — uma a débito e uma a crédito." };
  }

  const debito = r2(linhas.reduce((s, l) => s + l.debit, 0));
  const credito = r2(linhas.reduce((s, l) => s + l.credit, 0));
  if (debito !== credito) {
    return {
      ok: false,
      erro: `Não fecha: débito ${debito.toFixed(2)} contra crédito ${credito.toFixed(2)}, `
        + `diferença ${r2(debito - credito).toFixed(2)}.`,
    };
  }
  if (debito === 0) return { ok: false, erro: "Um lançamento de zero não é um lançamento." };

  return { ok: true, linhas };
}

/** As linhas mudaram mesmo? Ajuste que não muda nada só suja o razão com três partidas. */
export function houveMudanca(antes: LinhaDoAjuste[], depois: LinhaDoAjuste[]): boolean {
  const chave = (ls: LinhaDoAjuste[]) => ls
    .map((l) => `${l.account_code}|${r2(l.debit)}|${r2(l.credit)}`)
    .sort().join(";");
  return chave(antes) !== chave(depois);
}
