/**
 * Importar funcionarios e acumulados de outro sistema — teste.
 *
 * "se eu trocar de ERP, vou precisar subir os dados... precisamos garantir que
 * a troca seja segura e confiavel."
 *
 * O que torna a troca segura NAO e a importacao: e a conferencia. Importar
 * acumulados errados nao da erro nenhum — a primeira folha sai plausivel e a
 * diferenca aparece meses depois, na conta da Revenue.
 *
 * Este ficheiro prova a leitura. A conferencia contra o motor esta na rota.
 */
const {
  lerCsv, lerNumero, lerData, lerFrequencia, lerBase, acharCabecalho, dividir, normalizar,
} = require("../.test-build/hr/importPuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

console.log("\n== numeros como cada sistema os escreve ==");
{
  ok(lerNumero("1234.56") === 1234.56, "1234.56 (irlandes)");
  ok(lerNumero("1,234.56") === 1234.56, "1,234.56 (milhar com virgula)");
  ok(lerNumero("1.234,56") === 1234.56, "1.234,56 (europeu)");
  ok(lerNumero("22241.26") === 22241.26, "o bruto acumulado do payslip real");
  ok(lerNumero("€ 653,85") === 653.85, "com simbolo de euro");
  ok(lerNumero("(45.00)") === -45, "negativo contabil entre parenteses");
  ok(lerNumero("1.234") === 1234, "1.234 sem casas decimais e MILHAR, nao 1,234");
  ok(lerNumero("12,50") === 12.5, "12,50 com duas casas e DECIMAL");
  ok(lerNumero("") === null && lerNumero("abc") === null, "vazio e lixo dao null");
  ok(lerNumero("0") === 0, "zero e zero, e nao null");
}

console.log("\n== datas ==");
{
  ok(lerData("2026-09-02") === "2026-09-02", "ISO passa direto");
  ok(lerData("02/09/2026") === "2026-09-02", "dd/mm/yyyy — a Irlanda escreve dia primeiro");
  ok(lerData("2-9-2026") === "2026-09-02", "com um digito");
  ok(lerData("31-Dec-2026") === "2026-12-31", "31-Dec-2026");
  // Adivinhar pelo valor (">12 logo e dia") acerta em 03/04 metade das vezes,
  // que e o mesmo que errar metade das vezes.
  ok(lerData("03/04/2026") === "2026-04-03", "03/04 e 3 de Abril, e nunca 4 de Marco");
  ok(lerData("") === null && lerData("lixo") === null, "vazio e lixo dao null");
}

console.log("\n== frequencia e base, como cada sistema as escreve ==");
{
  ok(lerFrequencia("W") === "weekly", "W (Sage)");
  ok(lerFrequencia("Weekly") === "weekly", "Weekly");
  ok(lerFrequencia("Semanal") === "weekly", "Semanal");
  ok(lerFrequencia("Fortnightly") === "fortnightly", "Fortnightly");
  ok(lerFrequencia("Quinzenal") === "fortnightly", "Quinzenal");
  ok(lerFrequencia("M") === "monthly", "M");
  ok(lerFrequencia("Mensal") === "monthly", "Mensal");
  ok(lerFrequencia("seja o que for") === null, "o que nao se reconhece da null, e nao um palpite");

  ok(lerBase("N") === "cumulativa", "N — o que esta no payslip do Sage");
  ok(lerBase("Normal") === "cumulativa", "Normal");
  ok(lerBase("Week 1") === "semana1", "Week 1");
  ok(lerBase("Emergency") === "emergencia", "Emergency");
}

console.log("\n== o separador sai do CABECALHO, e nao da primeira linha ==");
{
  /*
   * A demo do Matheus tinha este defeito exacto, e ele parte com qualquer
   * ficheiro europeu: o Excel em PT/ES/DE/FR grava com `;`, e adivinhar pela
   * primeira linha falha quando essa linha e um titulo sem separador nenhum.
   */
  const comTitulo = [
    "Relatorio de funcionarios - Setembro 2026",
    "",
    "First name;Surname;PPS;Gross Pay;Tax Paid",
    "Aoife;Brennan;1234567T;22241.26;1755.70",
  ].join("\n");
  const c = acharCabecalho(comTitulo);
  ok(c && c.sep === ";", "acha o ';' apesar do titulo sem separador", c && c.sep);
  ok(c && c.linha === 2, "e diz em que linha esta o cabecalho", c && c.linha);

  const tab = "First name\tSurname\tPPS\nAoife\tBrennan\t1234567T";
  ok(acharCabecalho(tab).sep === "\t", "tabulacao tambem");
  ok(acharCabecalho("nada de util aqui\noutra linha") === null, "ficheiro sem cabecalho da null");
}

console.log("\n== aspas: a virgula dentro delas nao separa ==");
{
  ok(dividir('a,"b,c",d', ",").join("|") === "a|b,c|d", "virgula dentro de aspas");
  ok(dividir('"O\'\'Donnell"', ",")[0] === "O''Donnell", "aspa dobrada e uma aspa literal");
}

console.log("\n== nomes de coluna: cada sistema chama-lhes outra coisa ==");
{
  ok(normalizar("  STD. CUT OFF  ") === "std cut off", "normaliza pontuacao e espacos");
  ok(normalizar("Função") === "funcao", "e acentos");

  const sage = [
    "Employee Number,First Name,Surname,PPS Number,Frequency,Gross Pay,Tax Paid,USC Paid,PRSI Paid,Total Ins Wk,Std Cut Off,Tax Credit,Tax/USC Status,PRSI Code",
    "212,Aoife,Brennan,1234567T,W,22241.26,1755.70,352.79,934.11,35,29615.60,2692.55,N,A1",
  ].join("\n");
  const r = lerCsv(sage, 2026);
  ok(r.ok, "le um cabecalho no formato do Sage", r.erro);
  ok(r.linhas.length === 1, "uma pessoa", r.linhas.length);
  const d = r.linhas[0].dados;
  ok(d.first_name === "Aoife" && d.surname === "Brennan", "nome e apelido");
  ok(d.pps_number === "1234567T", "PPS");
  ok(d.freq_type === "weekly", "W -> weekly");
  ok(d.tax_basis === "cumulativa", "N -> cumulativa");
  ok(d.prsi_class === "A1", "classe de PRSI");
  ok(d.ytd_opening_gross_cents === 2224126, "bruto acumulado em centimos", d.ytd_opening_gross_cents);
  ok(d.ytd_opening_paye_cents === 175570, "PAYE acumulado", d.ytd_opening_paye_cents);
  ok(d.ytd_opening_usc_cents === 35279, "USC acumulado", d.ytd_opening_usc_cents);
  ok(d.ytd_opening_prsi_cents === 93411, "PRSI acumulado", d.ytd_opening_prsi_cents);
  ok(d.ytd_opening_year === 2026, "e o ANO do acumulado, sem o qual ele entraria na folha errada");
  ok(d.insurable_weeks === 35, "semanas seguraveis");
  ok(d.rpn_cutoff_cents === 2961560 && d.rpn_credits_cents === 269255, "cut-off e creditos do RPN");
}

console.log("\n== o tipo de pagamento deduz-se do que veio ==");
{
  // Metade dos exportadores nao tem coluna "pay type": tem taxa OU salario.
  const horista = lerCsv("First name,Surname,Hourly Rate\nSean,Kavanagh,16.50", 2026);
  ok(horista.linhas[0].dados.pay_type === "Hourly", "so taxa horaria -> Hourly");

  const salario = lerCsv("First name,Frequency,Salary\nNiamh,Monthly,3400", 2026);
  ok(salario.linhas[0].dados.pay_type === "Monthly Fixed", "so salario mensal -> Monthly Fixed",
     salario.linhas[0].dados.pay_type);

  const quinzenal = lerCsv("First name,Frequency,Salary\nKevin,Fortnightly,2100", 2026);
  ok(quinzenal.linhas[0].dados.pay_type === "Fortnightly Fixed", "e o fixo casa com a frequencia");
}

console.log("\n== o que ele avisa antes de deixar gravar ==");
{
  // O erro mais caro do ficheiro: bruto acumulado com PAYE zero. A primeira
  // folha devolve a pessoa o imposto do ano inteiro.
  const semImposto = lerCsv("First name,Hourly Rate,Gross Pay,Tax Paid\nAoife,16.50,22241.26,0", 2026);
  ok(semImposto.linhas[0].avisos.some((a) => /devolve/.test(a)),
     "bruto acumulado com PAYE zero e avisado, alto", semImposto.linhas[0].avisos);

  const soImposto = lerCsv("First name,Hourly Rate,Tax Paid\nAoife,16.50,1755.70", 2026);
  ok(soImposto.linhas[0].avisos.some((a) => /ignorado/.test(a)),
     "imposto acumulado sem bruto e ignorado, e diz-se");

  const ppsMau = lerCsv("First name,Hourly Rate,PPS\nAoife,16.50,1234567Z", 2026);
  ok(ppsMau.linhas[0].erro && /digito de controlo/.test(ppsMau.linhas[0].erro),
     "PPS com digito trocado nao entra", ppsMau.linhas[0].erro);

  const semTaxa = lerCsv("First name,Surname\nAoife,Brennan", 2026);
  ok(semTaxa.linhas[0].erro, "sem taxa nem salario, a linha nao entra", semTaxa.linhas[0].erro);
}

console.log("\n== colunas que nao se sabem ler nao sao erro ==");
{
  const r = lerCsv("First name,Hourly Rate,Department,Cost Centre\nAoife,16.50,Kitchen,42", 2026);
  ok(r.ok && r.linhas.length === 1, "o ficheiro passa");
  ok(r.ignoradas.includes("Department") && r.ignoradas.includes("Cost Centre"),
     "e as colunas de que nao se sabe dizem-se, para ninguem achar que foram lidas", r.ignoradas);
}

console.log("\n== o rodape de totais nao vira pessoa ==");
{
  const r = lerCsv([
    "First name,Surname,Hourly Rate,Gross Pay",
    "Aoife,Brennan,16.50,22241.26",
    ",,,44482.52",
  ].join("\n"), 2026);
  ok(r.linhas.length === 1, "linha sem nome nenhum e descartada", r.linhas.length);
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
