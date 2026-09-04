/**
 * AS REGRAS QUE MUDAM DE EMPRESA PARA EMPRESA — teste.
 *
 * O que este teste guarda, por ordem de importância:
 *
 * 1. **O domingo sem prémio deixa de ser silencioso.** Era: quem não
 *    preenchesse a taxa de domingo na ficha pagava o domingo como uma
 *    terça-feira, sem aviso nenhum. O número continua o mesmo — mudá-lo sem
 *    ninguém pedir seria pior — mas agora grita.
 * 2. **A precedência**: funcionário > empresa > lei. O contrato individual
 *    existe; a lei é um mínimo, e dar mais é legal.
 * 3. **Meia regra não é regra.** Um limiar de extras sem multiplicador não diz
 *    o que fazer, e aplicar metade produziria um número plausível e errado.
 */
const {
  regrasPara, brutoDaSemana, feriasDaSemana, LEI,
} = require("../.test-build/hr/regrasDaEmpresa");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};
const perto = (a, b) => Math.abs(a - b) < 0.005;

console.log("\n== O DOMINGO A DOBRAR, definido NA EMPRESA ==");
{
  const r = regrasPara({ sunday_mode: "multiplier", sunday_multiplier: 2 }, { hourly_rate: 13 });
  ok(r.taxaDomingo === 26, "13,00 x 2 = 26,00 ao domingo", r.taxaDomingo);
  ok(r.origemDomingo === "empresa", "e o ecra sabe que a regra e da empresa");
  ok(r.avisos.length === 0, "e nao ha nada a avisar");

  const b = brutoDaSemana(r, { normais: 32, domingo: 8 });
  ok(perto(b.total, 32 * 13 + 8 * 26), "32h normais + 8h a dobrar", b.total);
  ok(b.parcelas.length === 2, "duas parcelas, para a conta se poder conferir");
  ok(b.parcelas[1].chave === "parcela.domingo" && b.parcelas[1].taxa === 26,
    "e a parcela do domingo mostra a TAXA, nao so o valor", b.parcelas[1]);
}

console.log("\n== 1,5x tambem, porque nem toda a gente paga a dobrar ==");
{
  const r = regrasPara({ sunday_mode: "multiplier", sunday_multiplier: 1.5 }, { hourly_rate: 13 });
  ok(r.taxaDomingo === 19.5, "13,00 x 1,5 = 19,50 — que e o que o Sean ja tem na ficha", r.taxaDomingo);
}

console.log("\n== O FUNCIONARIO GANHA A EMPRESA ==");
{
  // O contrato individual diferente do resto da casa existe, e apagar essa
  // possibilidade para simplificar trocaria um problema por outro.
  const r = regrasPara({ sunday_mode: "multiplier", sunday_multiplier: 2 },
                       { hourly_rate: 13, sunday_rate: 30 });
  ok(r.taxaDomingo === 30, "a taxa da ficha ganha ao multiplicador da empresa", r.taxaDomingo);
  ok(r.origemDomingo === "funcionario", "e diz-se de onde veio");
}

console.log("\n== O CASO SILENCIOSO QUE ISTO FECHA ==");
{
  // Nem taxa na ficha, nem regra na empresa: o domingo era pago como um dia
  // normal e ninguem ficava a saber.
  const r = regrasPara({}, { hourly_rate: 13 });
  ok(r.taxaDomingo === 13, "o NUMERO nao muda — mudar sem ninguem pedir seria pior", r.taxaDomingo);
  ok(r.origemDomingo === "semPremio", "mas a origem diz que nao ha premio nenhum");
  ok(r.avisos.includes("regra.semPremioDomingo"), "E AVISA-SE, que e o que faltava");
}

console.log("\n== mas o aviso so aparece a quem TRABALHOU ao domingo ==");
{
  const r = regrasPara({}, { hourly_rate: 13 });
  const comDomingo = brutoDaSemana(r, { normais: 32, domingo: 8 });
  const semDomingo = brutoDaSemana(r, { normais: 40, domingo: 0 });
  ok(comDomingo.avisos.includes("regra.semPremioDomingo"), "quem fez domingo: avisa");
  ok(!semDomingo.avisos.includes("regra.semPremioDomingo"),
    "quem nao fez: nao avisa — um aviso que aparece em toda a gente deixa de ser lido");
}

console.log("\n== horas extras a partir de um limiar ==");
{
  const r = regrasPara({ overtime_after_hours: 39, overtime_multiplier: 1.5 }, { hourly_rate: 10 });
  ok(r.extrasAPartirDe === 39 && r.taxaExtra === 15, "a partir de 39h, a 15,00", r);

  const b = brutoDaSemana(r, { normais: 45, domingo: 0 });
  ok(b.parcelas.length === 2, "parte-se em normais e extras", b.parcelas);
  ok(perto(b.total, 39 * 10 + 6 * 15), "39h a 10 + 6h a 15", b.total);
  ok(b.parcelas[1].horas === 6, "seis horas extras", b.parcelas[1]);

  const dentro = brutoDaSemana(r, { normais: 38, domingo: 0 });
  ok(dentro.parcelas.length === 1 && perto(dentro.total, 380), "abaixo do limiar nao ha extras");
}

console.log("\n== o DOMINGO nao conta para o limiar das extras ==");
{
  // Ele ja e pago a premio. Fazer o domingo empurrar as horas normais para
  // acima do limiar pagaria duas vezes o mesmo excesso.
  const r = regrasPara(
    { overtime_after_hours: 39, overtime_multiplier: 1.5, sunday_mode: "multiplier", sunday_multiplier: 2 },
    { hourly_rate: 10 }
  );
  const b = brutoDaSemana(r, { normais: 35, domingo: 8 });
  ok(!b.parcelas.some((p) => p.chave === "parcela.extras"),
    "35 normais + 8 de domingo NAO faz extras", b.parcelas.map((p) => p.chave));
  ok(perto(b.total, 35 * 10 + 8 * 20), "e paga 35 a 10 mais 8 a 20", b.total);
}

console.log("\n== MEIA REGRA NAO E REGRA ==");
{
  const so_limiar = regrasPara({ overtime_after_hours: 39 }, { hourly_rate: 10 });
  ok(so_limiar.extrasAPartirDe === null, "limiar sem multiplicador nao produz extras");
  ok(so_limiar.avisos.includes("regra.extrasIncompleta"), "e diz que a regra esta por acabar");

  const so_mult = regrasPara({ overtime_multiplier: 1.5 }, { hourly_rate: 10 });
  ok(so_mult.extrasAPartirDe === null, "multiplicador sem limiar tambem nao");
  ok(so_mult.avisos.includes("regra.extrasIncompleta"), "e avisa igual");

  const b = brutoDaSemana(so_limiar, { normais: 45, domingo: 0 });
  ok(perto(b.total, 450), "e as 45 horas pagam-se todas a taxa normal, sem inventar nada", b.total);
}

console.log("\n== FERIAS: a lei e um MINIMO, e ha quem de mais ==");
{
  const legal = regrasPara({}, { hourly_rate: 12 });
  ok(legal.feriasPct === LEI.feriasPct && legal.feriasPct === 8, "sem configuracao, os 8% da lei", legal.feriasPct);
  ok(legal.feriasDias === 20, "e os 20 dias");

  // O caso que o Alfredo descreveu: a empresa onde ele trabalha aumenta as ferias.
  const generosa = regrasPara({ holiday_accrual_pct: 12, holiday_days_year: 25 }, { hourly_rate: 12 });
  ok(generosa.feriasPct === 12 && generosa.feriasDias === 25, "e uma empresa pode dar mais", generosa);

  ok(perto(feriasDaSemana(legal, 40), 3.2), "40h a 8% = 3,2 horas de ferias", feriasDaSemana(legal, 40));
  ok(perto(feriasDaSemana(generosa, 40), 4.8), "40h a 12% = 4,8", feriasDaSemana(generosa, 40));
}

console.log("\n== nada configurado nao rebenta ==");
{
  const r = regrasPara(null, {});
  ok(r.taxaHora === 0 && r.taxaDomingo === 0, "sem taxa hora, tudo a zero");
  ok(brutoDaSemana(r, { normais: 0, domingo: 0 }).total === 0, "semana vazia da zero");
  ok(brutoDaSemana(r, { normais: -5, domingo: -2 }).total === 0, "horas negativas nao geram valor negativo");
}

console.log(`\n${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
