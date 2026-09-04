const assert = require("assert");
const {
  chaveDoTituloDaFolha, partirAFolha, periodoDaSemana,
  referenciaDoTituloDaFolha, vencimentoDoImpostoDaFolha,
} = require("../.test-build/hr/titulosDaFolhaPuro.js");

/*
 * O QUE ESTE TESTE FIXA
 *
 * Não a implementação — as DECISÕES que custaram a tomar e que, mudadas sem se
 * dar por isso, produzem dívida a dobrar ou dívida em falta.
 */

// ------------------------------------------------------------ idempotência
{
  const a = chaveDoTituloDaFolha("cli-1", 2026, 9, "monthly", "liquido");
  const b = chaveDoTituloDaFolha("cli-1", 2026, 9, "monthly", "liquido");
  // Fechar a folha duas vezes tem de dar a MESMA chave: é ela que o índice
  // único de (client_id, document_id) usa para recusar o título gémeo.
  assert.strictEqual(a, b, "a mesma folha tem de dar sempre a mesma chave");
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "tem de ser um uuid v5 valido, senao o Postgres recusa a coluna");

  // E as quatro coisas que distinguem uma folha de outra têm mesmo de
  // distinguir a chave. Qualquer uma delas colar duas folhas diferentes na
  // mesma chave faria a segunda não criar título nenhum — em silêncio.
  const distintas = new Set([
    a,
    chaveDoTituloDaFolha("cli-2", 2026, 9, "monthly", "liquido"),
    chaveDoTituloDaFolha("cli-1", 2025, 9, "monthly", "liquido"),
    chaveDoTituloDaFolha("cli-1", 2026, 8, "monthly", "liquido"),
    chaveDoTituloDaFolha("cli-1", 2026, 9, "weekly", "liquido"),
    chaveDoTituloDaFolha("cli-1", 2026, 9, "monthly", "imposto"),
  ]);
  assert.strictEqual(distintas.size, 6, "cliente, ano, periodo, frequencia e tipo separam");
}

// ------------------------------------------------- o vencimento do imposto
{
  // Dia 14 do mês SEGUINTE ao do pagamento — o prazo do PAYE/PRSI mensal.
  assert.strictEqual(vencimentoDoImpostoDaFolha("2026-09-25"), "2026-10-14");
  // O mês que manda é o do PAGAMENTO, e não o do período: uma folha da semana 5
  // paga a 3 de Fevereiro vence a 14 de Março.
  assert.strictEqual(vencimentoDoImpostoDaFolha("2026-02-03"), "2026-03-14");
  // Dezembro vira Janeiro do ano seguinte. Sem isto o título nascia vencido há
  // onze meses e aparecia no topo da lista de atrasados.
  assert.strictEqual(vencimentoDoImpostoDaFolha("2026-12-31"), "2027-01-14");
}

// ------------------------------------------------------- o que vai em cada
{
  const t = { liquido: 200000, paye: 40000, usc: 8000, prsiEe: 16000, prsiEr: 45000 };
  const { liquidoCents, impostoCents } = partirAFolha(t);
  assert.strictEqual(liquidoCents, 200000, "o titulo dos salarios e o LIQUIDO");
  // O PRSI do EMPREGADOR entra no título do imposto. Não sai do salário de
  // ninguém, mas vai na mesma transferência para a Revenue — deixá-lo de fora
  // dava um título mais pequeno do que o pagamento, e a conciliação parava.
  assert.strictEqual(impostoCents, 40000 + 8000 + 16000 + 45000);

  // Bruto = líquido + o que se retém ao trabalhador. Somados, os dois títulos
  // dão o CUSTO DO EMPREGADOR, que é o que sai mesmo do banco.
  assert.strictEqual(liquidoCents + impostoCents, 309000);

  // Devolução grande de PAYE pode virar o imposto ao contrário: aí a Revenue
  // deve, e não se cria título nenhum. Quem chama trata; aqui só se vê o sinal.
  const devolve = partirAFolha({ liquido: 100000, paye: -50000, usc: 1000, prsiEe: 4000, prsiEr: 11000 });
  assert.ok(devolve.impostoCents < 0, "saldo a favor tem de dar negativo, e nao zero");
}

// -------------------------------------------------------------- referência
{
  assert.strictEqual(referenciaDoTituloDaFolha(2026, 9, "monthly", "liquido"), "FOLHA 2026-M09 LIQ");
  assert.strictEqual(referenciaDoTituloDaFolha(2026, 36, "weekly", "imposto"), "FOLHA 2026-S36 IMP");
  assert.strictEqual(referenciaDoTituloDaFolha(2026, 5, "fortnightly", "liquido"), "FOLHA 2026-Q05 LIQ");
}

// ------------------------------- a guarda contra duplicado, nos dois sentidos
{
  // O quadro semanal raciocina por SEMANA e a folha moderna por PERÍODO. Sem
  // saber traduzir de um para o outro, os dois criavam título para o mesmo
  // salário — com valores diferentes (bruto contra líquido), que é o pior caso,
  // porque as duas linhas parecem coisas distintas na lista.
  assert.strictEqual(periodoDaSemana("weekly", 2026, 36), 36);
  assert.strictEqual(periodoDaSemana("fortnightly", 2026, 1), 1);
  assert.strictEqual(periodoDaSemana("fortnightly", 2026, 2), 1);
  assert.strictEqual(periodoDaSemana("fortnightly", 2026, 3), 2);
  // Mensal: a semana pertence ao mês da sua QUINTA-FEIRA, a mesma regra que
  // `semanasDoPeriodo` usa do outro lado. Se as duas divergissem, a guarda
  // procurava no mês errado e deixava passar o duplicado.
  assert.strictEqual(periodoDaSemana("monthly", 2026, 36), 9);
  assert.strictEqual(periodoDaSemana("monthly", 2026, 1), 1);
}

console.log("titulosDaFolha: ok");
