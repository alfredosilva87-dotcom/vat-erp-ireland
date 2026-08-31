/**
 * Gera a migracao que instala o plano de contas da PRATICA.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SUBSTITUIR E NAO ACRESCENTAR
 *
 * O sistema nasceu com 41 contas de arranque — um plano minimo para o motor
 * ter onde lancar. O escritorio usa outro, de 499 contas, que e o que eles
 * conhecem e o que sai nos relatorios que ja entregam.
 *
 * Ter os dois seria pior do que qualquer um deles: 540 contas no seletor, com
 * duas "Sales" e dois "Trade debtors", e ninguem a saber em qual lancar.
 * ---------------------------------------------------------------------------
 *
 * O MAPA e escrito a mao, e nao por semelhanca de texto. Tentei automatico e
 * produziu erros graves — "Rent and rates" foi parar a `051 Rent receivable`,
 * que e RECEITA. Num plano de contas um emparelhamento errado nao da erro: da
 * um balanco plausivel e falso.
 */
const { extrair } = require("./extrair-plano");

/**
 * As 41 contas antigas e para onde vao.
 *
 * Cada linha foi escolhida olhando para a seccao de destino no plano novo, e
 * nao pelo nome. Os comentarios registam as que exigiram decisao.
 */
const MAPA = {
  "1100": "771",     // Bank -> Bank current account
  "1110": "781",     // Cash -> Petty cash account
  "1200": "711",     // Trade debtors -> Sales ledger CONTROL (e o que o razao usa)
  "1300": "736",     // VAT receivable -> VAT repayable (activo)
  "1400": "751",     // Prepayments
  "1500": "701",     // Inventory -> Stock of finished goods
  "1600": "651",     // Fixed assets -> Plant and machinery
  "1690": "392",     // Accumulated depreciation -> Depreciation of tangible assets
  "2100": "812",     // Trade creditors -> Purchase ledger CONTROL
  "2200": "845",     // VAT payable -> VAT control account
  "2300": "846",     // PAYE/PRSI/USC -> PAYE control account
  "2400": "871",     // Payroll liabilities -> Wages and salaries control
  "2500": "881",     // Accruals
  "2600": "904",     // Loans -> Bank loan balance (LONGO prazo, nao o 807 de curto)
  "2900": "831",     // Corporation tax payable
  "3100": "951",     // Share capital -> Ordinary equity share capital
  "3200": "991",     // Retained earnings -> Retained profit brought forward
  "4100": "001",     // Sales
  "4200": "076",     // Service revenue -> Service fees receivable
  "4900": "081",     // Other income
  "5100": "112",     // Purchases
  "5200": "111",     // Direct costs -> Materials
  "6100": "322",     // Rent and rates -> Rent PAYABLE (o automatico dava a receber)
  "6200": "116",     // Meals and entertainment -> Entertaining
  "6300": "371",     // Bank charges
  "6400": "345",     // Telecommunications -> Telephone/Broadband
  "6500": "331",     // Utilities -> Light and heat
  "6600": "326",     // Insurance
  "6700": "346",     // Software -> Computer costs
  "6750": "341",     // Printing, postage and stationery
  "6800": "114",     // Motor and travel -> Motor expenses
  "6850": "334",     // Repairs and maintenance
  "6900": "365",     // Professional fees -> Legal and professional (ADMIN, nao o 160 de custo)
  "6910": "342",     // Advertising
  "6950": "301",     // Salaries -> Wages and salaries
  "6960": "303",     // Employer PRSI
  "6990": "381",     // Other expenses -> General expenses
  "7100": "471",     // Interest payable -> Bank interest paid and payable
  "7200": "377",     // FX gain/loss -> Profit/loss on exchange
  "8100": "501",     // Corporation tax (despesa) -> Corporation tax current year
  "9999": "999",     // Rounding -> Balance sheet suspense
};

const esc = (s) => String(s).replace(/'/g, "''");

function gerar(ficheiro) {
  const { contas } = extrair(ficheiro);
  const porCodigo = new Map(contas.map((c) => [c.code, c]));

  const faltam = Object.entries(MAPA).filter(([, novo]) => !porCodigo.has(novo));
  if (faltam.length) {
    throw new Error("codigos de destino que nao existem no plano: " + JSON.stringify(faltam));
  }

  const linhas = contas.map((c) =>
    `  ('${esc(c.code)}', '${esc(c.description)}', '${c.type}', '${c.report_group}', ` +
    `${c.parent_code ? `'${esc(c.parent_code)}'` : "null"}, true)`
  ).join(",\n");

  const remap = Object.entries(MAPA).map(([v, n]) => `    ('${v}', '${n}')`).join(",\n");

  return { sql: montar(linhas, remap), total: contas.length };
}

function montar(linhas, remap) {
  return `-- O PLANO DE CONTAS DA PRATICA (499 contas).
--
-- ---------------------------------------------------------------------------
-- POR QUE ISTO SUBSTITUI, E NAO ACRESCENTA
--
-- O sistema nasceu com 41 contas de arranque — o minimo para o motor ter onde
-- lancar. O escritorio usa outro plano, de 499 contas, que e o que eles
-- conhecem e o que sai nos relatorios que ja entregam aos clientes.
--
-- Ter os dois seria pior do que qualquer um deles: 540 contas no seletor, com
-- duas "Sales" e dois "Trade debtors", e ninguem a saber em qual lancar.
--
-- As antigas NAO SAO APAGADAS — ficam inativas. Apagar partiria qualquer linha
-- de razao que eu nao tenha remapeado, e a partiria em silencio: uma partida
-- que aponta para uma conta que nao existe nao da erro, so desaparece dos
-- relatorios.
-- ---------------------------------------------------------------------------

-- 1. AS CONTAS NOVAS ------------------------------------------------------
insert into chart_of_accounts (code, description, type, report_group, parent_code, postable)
values
${linhas}
on conflict (code) where client_id is null do update
  set description = excluded.description,
      type = excluded.type,
      report_group = excluded.report_group,
      parent_code = excluded.parent_code,
      postable = excluded.postable,
      active = true;

-- 2. O MAPA DAS ANTIGAS ---------------------------------------------------
--
-- Escrito a mao, olhando para a seccao de destino. Emparelhar por semelhanca
-- de texto foi tentado e produziu erros graves — "Rent and rates" ia parar a
-- "Rent receivable", que e RECEITA. Num plano de contas, um emparelhamento
-- errado nao da erro: da um balanco plausivel e falso.
create temporary table _mapa_plano (velho text primary key, novo text not null);
insert into _mapa_plano (velho, novo) values
${remap};

-- 3. LEVAR O QUE JA ESTA LANCADO PARA OS CODIGOS NOVOS --------------------
--
-- A ordem nao importa entre estas, mas TODAS tem de correr: uma tabela
-- esquecida fica a apontar para uma conta inativa, e o saldo dela sai dos
-- relatorios sem aviso.
update journal_lines jl set account_code = m.novo
  from _mapa_plano m where jl.account_code = m.velho;

update ledger_items li set account_code = m.novo
  from _mapa_plano m where li.account_code = m.velho;

update sales s set account_code = m.novo
  from _mapa_plano m where s.account_code = m.velho;

update bank_accounts b set account_code = m.novo
  from _mapa_plano m where b.account_code = m.velho;

update client_item_accounts c set account_code = m.novo
  from _mapa_plano m where c.account_code = m.velho;

-- 4. AS ANTIGAS SAEM DE CIRCULACAO ----------------------------------------
update chart_of_accounts set active = false
where client_id is null and code in (select velho from _mapa_plano);

drop table _mapa_plano;
`;
}

if (require.main === module) {
  const r = gerar(process.argv[2]);
  process.stderr.write(`${r.total} contas\n`);
  process.stdout.write(r.sql);
}
module.exports = { gerar, MAPA };
