/**
 * O cadastro de funcionario — teste.
 *
 * Fecha a lacuna: ate aqui o RH so LIA funcionarios, e quem semeava era SQL
 * directo. Enquanto foi assim, o escritorio nao conseguia admitir ninguem.
 *
 * As invariantes que isto protege sao as que produzem numeros errados sem dar
 * erro nenhum: pay_type que nao casa com a frequencia, taxa e valor fixo
 * guardados ao mesmo tempo, PPS com digito trocado, e acumulado de abertura
 * sem ano.
 */
const { criticarFuncionario, ppsValido, payTypesDe, FIXO_DE } =
  require("../.test-build/hr/funcionarioPuro");

let pass = 0, fail = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const bom = {
  first_name: "Aoife", surname: "Brennan", freq_type: "weekly", pay_type: "Hourly",
  hourly_rate: 18.5, sunday_rate: 27.75, start_date: "2024-03-06",
  tax_basis: "cumulativa", marital_status: "solteiro",
};

console.log("\n== o digito de controlo do PPS ==");
{
  // Um PPS trocado num digito nao da erro AQUI: da na Revenue, meses depois, e
  // pode ir contra a pessoa errada. Por isso se confere na entrada.
  // Modulo 23, pesos 8..2. Gerados a partir do proprio algoritmo:
  const gerar = (d7) => {
    let s = 0;
    for (let i = 0; i < 7; i++) s += Number(d7[i]) * (8 - i);
    const r = s % 23;
    return d7 + (r === 0 ? "W" : String.fromCharCode(64 + r));
  };
  const validos = ["1234567", "0000001", "7654321", "9999999"].map(gerar);
  for (const p of validos) ok(ppsValido(p), `${p} e valido`);

  // Trocar a letra invalida.
  const p = validos[0];
  const outra = p.slice(0, 7) + (p[7] === "A" ? "B" : "A");
  ok(!ppsValido(outra), `${outra} — letra trocada e recusada`);

  ok(!ppsValido("123456"), "curto demais");
  ok(!ppsValido("12345678A"), "digitos a mais");
  ok(!ppsValido("ABCDEFGH"), "sem digitos");
  ok(!ppsValido(""), "vazio");
  // A segunda letra existe e nao entra no calculo do controlo quando e W.
  ok(ppsValido(p + "W"), `${p}W — segunda letra W aceite`);
}

console.log("\n== pay_type tem de casar com a frequencia ==");
{
  ok(payTypesDe("weekly").join() === "Hourly,Weekly Fixed", "semanal aceita Hourly e Weekly Fixed");
  ok(payTypesDe("monthly").join() === "Hourly,Monthly Fixed", "mensal aceita Hourly e Monthly Fixed");
  ok(FIXO_DE.fortnightly === "Fortnightly Fixed", "quinzenal tem o seu proprio fixo");

  const errado = criticarFuncionario({ ...bom, freq_type: "monthly", pay_type: "Weekly Fixed" });
  ok(!errado.ok && /so pode ser/.test(errado.erro),
     "mensal com contrato SEMANAL e recusado", errado.erro);

  const certo = criticarFuncionario({
    ...bom, freq_type: "monthly", pay_type: "Monthly Fixed",
    hourly_rate: null, fixed_amount: 3400,
  });
  ok(certo.ok, "mensal com contrato mensal passa", certo.erro);
}

console.log("\n== taxa e valor fixo excluem-se ==");
{
  // Guardar os dois deixa a pergunta "qual manda?" para a hora do calculo, e a
  // resposta muda conforme quem le.
  const r = criticarFuncionario({ ...bom, fixed_amount: 3000 });
  ok(r.ok && r.limpo.fixed_amount === null,
     "horista: o valor de contrato e LIMPO, nao deixado a zero", r.ok && r.limpo.fixed_amount);

  const f = criticarFuncionario({
    ...bom, freq_type: "monthly", pay_type: "Monthly Fixed", fixed_amount: 3400,
  });
  ok(f.ok && f.limpo.hourly_rate === null && f.limpo.sunday_rate === null,
     "fixo: as taxas horarias sao limpas");

  const semTaxa = criticarFuncionario({ ...bom, hourly_rate: 0 });
  ok(!semTaxa.ok && /sairia sempre zero/.test(semTaxa.erro), "horista sem taxa e recusado");

  const semValor = criticarFuncionario({
    ...bom, freq_type: "monthly", pay_type: "Monthly Fixed", fixed_amount: 0,
  });
  ok(!semValor.ok, "fixo sem valor e recusado");
}

console.log("\n== o acumulado de abertura sem ano ==");
{
  // A armadilha de quem migra do CollSoft a meio do ano: o acumulado de 2025
  // entrava na folha de 2026 e a pessoa levava um ano de imposto devolvido.
  const semAno = criticarFuncionario({ ...bom, ytd_opening_gross_cents: 1500000 });
  ok(!semAno.ok && /a que ANO/.test(semAno.erro), "acumulado sem ano e recusado", semAno.erro);

  const comAno = criticarFuncionario({
    ...bom, ytd_opening_gross_cents: 1500000, ytd_opening_year: 2026,
  });
  ok(comAno.ok, "com o ano, passa");

  const naoCumulativa = criticarFuncionario({
    ...bom, tax_basis: "semana1", ytd_opening_gross_cents: 1500000, ytd_opening_year: 2026,
  });
  ok(naoCumulativa.ok && naoCumulativa.avisos.some((a) => /ignorado/.test(a)),
     "e avisa que noutra base ele nao e usado", naoCumulativa.avisos);
}

console.log("\n== o que e aviso e nao erro ==");
{
  const semPps = criticarFuncionario({ ...bom, pps_number: "" });
  ok(semPps.ok, "sem PPS o cadastro passa");
  ok(semPps.avisos.some((a) => /Revenue/.test(a)),
     "mas avisa que nao se entrega nada sem ele", semPps.avisos);

  const domingoBarato = criticarFuncionario({ ...bom, sunday_rate: 10 });
  ok(domingoBarato.ok && domingoBarato.avisos.some((a) => /domingo/i.test(a)),
     "domingo mais barato que dia util e avisado, nao recusado");

  const emergencia = criticarFuncionario({ ...bom, tax_basis: "emergencia" });
  ok(emergencia.ok && emergencia.avisos.some((a) => /RPN/.test(a)),
     "base de emergencia manda pedir o RPN");
}

console.log("\n== o basico ==");
{
  ok(!criticarFuncionario({ ...bom, first_name: "  " }).ok, "sem primeiro nome e recusado");
  ok(!criticarFuncionario({ ...bom, freq_type: "" }).ok, "sem bloco de payslip e recusado");
  const datas = criticarFuncionario({ ...bom, start_date: "2026-05-01", end_date: "2026-01-01" });
  ok(!datas.ok && /anterior/.test(datas.erro), "saida antes da entrada e recusada");
  ok(!criticarFuncionario({ ...bom, tax_basis: "inventada" }).ok, "base desconhecida e recusada");
  ok(!criticarFuncionario({ ...bom, marital_status: "inventada" }).ok, "situacao desconhecida e recusada");

  const r = criticarFuncionario({ ...bom, prsi_class: "" });
  ok(r.ok && r.limpo.prsi_class === "A1", "classe de PRSI cai em A1 por omissao");
}

console.log("\n== auto-enrolment ==");
{
  /*
   * Tres estados, e nao dois. O <select> vazio manda "" e isso NAO e "nao
   * inscrito": e "ainda nao se avaliou". Confundi-los faria o sistema tratar
   * trabalho por fazer como uma decisao ja tomada, e ninguem voltaria la.
   */
  const porAvaliar = criticarFuncionario({ ...bom, ae_enrolled: "" });
  ok(porAvaliar.ok && porAvaliar.limpo.ae_enrolled === null,
     "o select vazio vira null, e nao false", porAvaliar.ok && porAvaliar.limpo.ae_enrolled);

  const dentro = criticarFuncionario({ ...bom, ae_enrolled: true, date_of_birth: "1990-04-12" });
  ok(dentro.ok && dentro.limpo.ae_enrolled === true, "inscrito fica inscrito");
  ok(dentro.ok && dentro.limpo.date_of_birth === "1990-04-12", "e a data de nascimento passa");

  /*
   * `""` numa coluna `date` do Postgres nao e vazio: e erro de sintaxe. E o
   * formulario manda string vazia em todo o campo que ninguem tocou.
   */
  const semData = criticarFuncionario({ ...bom, date_of_birth: "" });
  ok(semData.ok && semData.limpo.date_of_birth === null,
     "data de nascimento vazia vira null, e nao string vazia");
  ok(semData.ok && semData.avisos.some((a) => /auto-enrolment/i.test(a)),
     "e sem ela avisa-se que o teste de idade nao se consegue aplicar");

  // Uma data de saida sem saida e lixo que contradiz o estado.
  const semSair = criticarFuncionario({ ...bom, ae_enrolled: true, ae_opt_out_date: "2026-03-01" });
  ok(semSair.ok && semSair.limpo.ae_opt_out_date === null,
     "quem esta inscrito nao guarda data de opt-out");

  const saiu = criticarFuncionario({ ...bom, ae_enrolled: false, ae_opt_out_date: "2026-03-01" });
  ok(saiu.ok && saiu.limpo.ae_opt_out_date === "2026-03-01",
     "quem saiu guarda a data em que saiu");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail ? 1 : 0);
