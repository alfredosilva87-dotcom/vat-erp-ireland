/**
 * Clientes de DEMONSTRAÇÃO com três anos e movimento em todos os módulos:
 * compras, vendas, banco, RH, obrigações e contabilidade.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTES CLIENTES EXISTEM
 *
 * O A1 Test Ltd só tem 2026 no razão, e a carga de abertura dele está datada
 * de 31/12/2025. Acrescentar 2025 ali contaria duas vezes contra a abertura e
 * derrubaria a demonstração que já foi conferida — por isso o histórico nasce
 * em clientes NOVOS, e o A1 fica exatamente como está.
 *
 * São TRÊS ANOS e não dois. Dois bastariam para a coluna de variação, mas
 * 2026 ainda está a correr: comparar oito meses contra um ano fechado faria
 * todo KPI aparecer a despencar por artefato do seed, e não por causa da
 * empresa. Com 2024 e 2025 fechados existe um comparativo cheio contra cheio,
 * 2026 continua a ser o ano corrente de verdade, e os gráficos ganham os três
 * pontos que a referência do Alfredo mostra.
 *
 * Tudo aqui é INVENTADO. Ver `scripts/demo-profiles.js` para os feitios das
 * três empresas e a razão de serem diferentes entre si.
 * ---------------------------------------------------------------------------
 *
 * Só roda contra localhost, como os outros scripts de dados de teste.
 *
 * Executar de novo REFAZ os três do zero (apaga só o que tem client_code
 * começado por DEMO-). É determinístico: a mesma rodada dá os mesmos números,
 * senão cada execução mudaria o relatório que se está a conferir.
 *
 * Uso:  SEED_EMAIL=... SEED_PASSWORD=... node scripts/seed-demo-clients.js
 *       node scripts/seed-demo-clients.js --sem-contabilizar
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const {
  ANOS, PERFIS, DESPESAS, FORNECEDORES_CUSTO, CLIENTES_VENDA, ORIGENS,
} = require("./demo-profiles");

function loadEnvLocal() {
  const p = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ------------------------------------------------------------- números

const r2 = (n) => Math.round(n * 100) / 100;
const HOJE = new Date().toISOString().slice(0, 10);
const ABERTURA = `${ANOS[0] - 1}-12-31`;

/**
 * Gerador determinístico (LCG). O seed sai do código do cliente, então cada
 * empresa tem a sua variação mensal e todas as rodadas dão o mesmo resultado.
 *
 * `Math.random` daria números diferentes a cada execução — e um relatório que
 * muda sozinho entre duas conferências não se consegue conferir.
 */
function rng(semente) {
  let s = 0;
  for (const c of String(semente)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MES = (ano, m) => `${ano}-${String(m).padStart(2, "0")}`;
const dia = (ano, m, d) => `${MES(ano, m)}-${String(d).padStart(2, "0")}`;
const ultimoDia = (ano, m) => new Date(Date.UTC(ano, m, 0)).getUTCDate();
const somarDias = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ------------------------------------------------------------- geração

/** As linhas de abertura, com os lucros acumulados a fechar. */
function linhasDeAbertura(a) {
  const ativo = a.banco + a.clientes + a.fixo + a.stock;
  const passivo = a.fornecedores + a.emprestimo + a.capital;
  /*
   * Os lucros acumulados são o que SOBRA — não um número escolhido.
   *
   * Assim a abertura fecha por construção. Inventar os oito valores e torcer
   * para baterem daria uma diferença que o motor recusa (a trava de partidas
   * dobradas é no banco), e o seed falharia sem dizer porquê.
   */
  const acumulado = r2(ativo - passivo);
  return [
    { account_code: "1100", debit: a.banco, credit: 0, description: "Bank" },
    { account_code: "1200", debit: a.clientes, credit: 0, description: "Trade debtors" },
    { account_code: "1600", debit: a.fixo, credit: 0, description: "Fixed assets" },
    { account_code: "1500", debit: a.stock, credit: 0, description: "Inventory" },
    { account_code: "2100", debit: 0, credit: a.fornecedores, description: "Trade creditors" },
    { account_code: "2600", debit: 0, credit: a.emprestimo, description: "Loans" },
    { account_code: "3100", debit: 0, credit: a.capital, description: "Share capital" },
    { account_code: "3200", debit: 0, credit: acumulado, description: "Retained earnings" },
  ].filter((l) => l.debit !== 0 || l.credit !== 0);
}

/** Compras, vendas e movimento de banco de um mês. */
function movimentoDoMes(perfil, ano, mes, rand) {
  const i = ANOS.indexOf(ano);
  const sazonal = 0.85 + rand() * 0.3; // para os gráficos não saírem uma reta
  const receitaMes = r2(perfil.receita * perfil.fatores[i] * sazonal);
  const custoMes = r2(receitaMes * perfil.custoRatio[i]);
  const inflacao = 1 + i * 0.04;
  const fim = ultimoDia(ano, mes);
  const compras = [], vendas = [], banco = [];

  // ---- custo das vendas, em duas notas ----
  for (let k = 0; k < 2; k++) {
    const net = r2(custoMes * (k === 0 ? 0.6 : 0.4));
    if (net <= 0) continue;
    compras.push({
      supplier: FORNECEDORES_CUSTO[Math.floor(rand() * FORNECEDORES_CUSTO.length)],
      numero: `${perfil.code.slice(-3)}-C${ano}${String(mes).padStart(2, "0")}${k + 1}`,
      data: dia(ano, mes, 4 + k * 9),
      conta: "5100", nomeConta: "Purchases",
      net, taxa: 0, credito: true, tipo: "invoice",
    });
  }

  // ---- estrutura: parte das despesas em cada mês ----
  for (const d of DESPESAS) {
    const sempre = ["6100", "6500", "6600", "6700"].includes(d.conta);
    if (!sempre && rand() > 0.6) continue;
    compras.push({
      supplier: d.fornecedor,
      numero: `${perfil.code.slice(-3)}-${d.conta}-${ano}${String(mes).padStart(2, "0")}`,
      data: dia(ano, mes, Math.min(fim, 6 + Math.floor(rand() * 18))),
      conta: d.conta, nomeConta: d.nome,
      net: r2(d.base * (0.9 + rand() * 0.25) * inflacao),
      taxa: d.taxa, credito: d.credito,
      tipo: d.conta === "6990" ? "receipt" : "invoice",
    });
  }

  // ---- vendas: uma fatura grande e o resumo do balcão ----
  const grande = r2(receitaMes * 0.65);
  vendas.push({
    cliente: CLIENTES_VENDA[Math.floor(rand() * CLIENTES_VENDA.length)],
    numero: `${perfil.code.slice(-3)}-V${ano}${String(mes).padStart(2, "0")}A`,
    data: dia(ano, mes, 12), net: grande, taxa: 23,
  });
  vendas.push({
    cliente: "Vendas de balcao",
    numero: `${perfil.code.slice(-3)}-V${ano}${String(mes).padStart(2, "0")}B`,
    data: dia(ano, mes, fim), net: r2(receitaMes - grande), taxa: 13.5,
  });

  // ---- folha e juros, pagos direto pelo banco ----
  banco.push({
    data: dia(ano, mes, Math.min(fim, 26)),
    descricao: `Folha de pagamento ${MES(ano, mes)}`,
    contato: "Payroll", valor: -r2(perfil.salarioMes * inflacao),
    conta: "6950", kind: "payment",
  });
  if (perfil.juros > 0) {
    banco.push({
      data: dia(ano, mes, Math.min(fim, 28)),
      descricao: "Juros do emprestimo", contato: "Bank of Ireland",
      valor: -r2(perfil.juros * (1 - i * 0.05)), conta: "7100", kind: "payment",
    });
  }
  /*
   * Movimento por classificar: sem conta e sem documento.
   *
   * NÃO é erro — é o que o contabilista ainda vai olhar, e o backfill trata
   * assim de propósito. Um seed onde tudo está classificado não exercita esse
   * caminho, que é justamente o que aparece todos os meses na vida real.
   */
  if (mes % 4 === 0) {
    banco.push({
      data: dia(ano, mes, Math.min(fim, 21)),
      descricao: "Transferencia a classificar", contato: null,
      valor: -r2(120 + rand() * 260), conta: null, kind: "payment",
    });
  }

  return { compras, vendas, banco };
}

// ------------------------------------------------------------- gravação

async function semearCliente(sb, p, companyId) {
  const rand = rng(p.code);

  const { data: cliente, error: eC } = await sb.from("clients").insert({
    client_code: p.code, name: p.name, vat_number: p.vat_number,
    cro: p.cro, revenue_number: p.revenue_number, employer_number: p.employer_number,
    contact_person: p.contact_person, email: p.email, phone: p.phone,
    address: p.address, activity_label: p.activity_label, status: "active",
    /*
     * Sem `company_id` o cliente existe e fica invisivel.
     *
     * O guarda de acesso (`lib/access.ts`) LIBERA recurso sem empresa de
     * proposito — e dado anterior ao multiempresa —, mas o `getClient` filtra
     * estrito por empresa. O resultado e o pior dos dois: a API de
     * contabilidade responde 200 e a do cadastro responde 404, entao a tela
     * carrega os numeros e fica presa em "Loading..." no nome do cliente, sem
     * erro nenhum no ecra.
     */
    company_id: companyId,
    notes: "Cliente de DEMONSTRACAO — dados inventados, gerado por scripts/seed-demo-clients.js",
  }).select("id").single();
  if (eC) { console.error(`${p.code}: ${eC.message}`); return null; }
  const id = cliente.id;

  // ---- abertura ----
  const { data: jAb } = await sb.from("journal").insert({
    client_id: id, entry_date: ABERTURA, posting_date: ABERTURA,
    source_module: "opening", description: "Saldos de abertura",
  }).select("id").single();
  await sb.from("journal_lines").insert(linhasDeAbertura(p.abertura).map((l, i) => ({
    journal_id: jAb.id, line_no: i + 1, ...l, resolved_by: "opening",
  })));
  await sb.from("opening_balances").insert({
    client_id: id, cutoff_date: ABERTURA,
    source_note: "Carga de demonstracao", journal_id: jAb.id,
  });

  const { data: conta } = await sb.from("bank_accounts").insert({
    client_id: id, name: "Conta corrente", bank_name: "Bank of Ireland",
    account_ref: `IE29BOFI9000${p.cro}`, currency: "EUR",
    opening_balance: p.abertura.banco, opening_date: ABERTURA, active: true,
  }).select("id").single();

  let nC = 0, nV = 0, nB = 0;

  for (const ano of ANOS) {
    for (let mes = 1; mes <= 12; mes++) {
      // 2026 corre até hoje: documento com data futura não se lança, e ficaria
      // parado fora do razão a fazer o balanço parecer errado.
      if (dia(ano, mes, 1) > HOJE) break;
      const mov = movimentoDoMes(p, ano, mes, rand);

      for (const c of mov.compras) {
        if (c.data > HOJE) continue;
        const vat = r2(c.net * c.taxa / 100);
        const { data: nota } = await sb.from("invoices").insert({
          client_id: id, client_code: p.code, client_name: p.name,
          supplier_name: c.supplier, invoice_number: c.numero,
          invoice_date: c.data, posting_date: c.data,
          doc_type: c.tipo, doc_kind: c.tipo === "receipt" ? "receipt" : "invoice",
          currency: "EUR", total_net: c.net, total_vat: vat, total_gross: r2(c.net + vat),
          total_credit: c.credito ? vat : 0, item_count: 1,
          engine: "seed", needs_review: false, extraction_confidence: 1,
          source: ORIGENS[Math.floor(rand() * ORIGENS.length)],
          captured_at: `${c.data}T09:15:00Z`,
        }).select("id").single();
        if (!nota) continue;
        await sb.from("invoice_items").insert({
          invoice_id: nota.id, description: c.nomeConta,
          quantity: 1, net_amount: c.net,
          vat_rate_on_invoice: c.taxa, vat_amount_on_invoice: vat,
          expected_vat_rate: c.taxa,
          account_code: c.conta, account_name: c.nomeConta,
          take_credit: c.credito, credit_value: c.credito ? vat : 0,
        });
        nC++;

        // Paga-se a maioria, e sempre com atraso: um razão em que tudo é pago
        // no próprio dia não exercita título nenhum.
        if (rand() < 0.82) {
          const iso = somarDias(c.data, 12 + Math.floor(rand() * 24));
          if (iso <= HOJE) {
            await sb.from("bank_transactions").insert({
              bank_account_id: conta.id, client_id: id, txn_date: iso,
              description: `Pagamento ${c.numero}`, contact_name: c.supplier,
              amount: -r2(c.net + vat), kind: "payment", invoice_id: nota.id,
            });
            nB++;
          }
        }
      }

      for (const v of mov.vendas) {
        if (v.data > HOJE) continue;
        const vat = r2(v.net * v.taxa / 100);
        const balcao = v.cliente === "Vendas de balcao";
        const { data: venda } = await sb.from("sales").insert({
          client_id: id, entry_date: v.data, doc_number: v.numero,
          customer: v.cliente, net_amount: v.net, vat_rate: v.taxa, vat_amount: vat,
          account_code: p.contaReceita, needs_review: false,
          source: balcao ? "upload" : "email", doc_kind: "invoice",
          captured_at: `${v.data}T18:40:00Z`, extraction_confidence: 1,
        }).select("id").single();
        if (!venda) continue;
        await sb.from("sales_items").insert({
          sale_id: venda.id, description: balcao ? "Resumo do periodo" : "Fornecimento",
          quantity: 1, unit_price: v.net, net_amount: v.net, vat_rate: v.taxa, vat_amount: vat,
        });
        nV++;

        if (rand() < 0.88) {
          const iso = somarDias(v.data, 8 + Math.floor(rand() * 26));
          if (iso <= HOJE) {
            await sb.from("bank_transactions").insert({
              bank_account_id: conta.id, client_id: id, txn_date: iso,
              description: `Recebimento ${v.numero}`, contact_name: v.cliente,
              amount: r2(v.net + vat), kind: "receipt", sale_id: venda.id,
            });
            nB++;
          }
        }
      }

      for (const b of mov.banco) {
        if (b.data > HOJE) continue;
        await sb.from("bank_transactions").insert({
          bank_account_id: conta.id, client_id: id, txn_date: b.data,
          description: b.descricao, contact_name: b.contato,
          amount: b.valor, kind: b.kind, account_code: b.conta,
        });
        nB++;
      }
    }

    // ---- obrigações do ano: VAT3 por bimestre + RTD anual ----
    for (let bim = 0; bim < 6; bim++) {
      const m1 = bim * 2 + 1, m2 = bim * 2 + 2;
      if (dia(ano, m1, 1) > HOJE) break;
      const venc = m2 === 12 ? `${ano + 1}-01-23` : dia(ano, m2 + 1, 23);
      const entregue = venc <= HOJE;
      await sb.from("obligations").insert({
        client_id: id, kind: "VAT3", year: ano,
        period_label: `${MES(ano, m1)}/${MES(ano, m2)}`,
        period_start: dia(ano, m1, 1), period_end: dia(ano, m2, ultimoDia(ano, m2)),
        due_date: venc,
        status: entregue ? "filed" : "open",
        filed_at: entregue ? `${venc}T10:00:00Z` : null,
      });
    }
    if (dia(ano, 1, 1) <= HOJE) {
      const venc = `${ano + 1}-01-23`;
      await sb.from("obligations").insert({
        client_id: id, kind: "RTD", year: ano, period_label: String(ano),
        period_start: dia(ano, 1, 1), period_end: dia(ano, 12, 31), due_date: venc,
        status: venc <= HOJE ? "filed" : "open",
        filed_at: venc <= HOJE ? `${venc}T10:00:00Z` : null,
      });
    }
  }

  await sb.from("recurring_obligations").insert([
    { client_id: id, name: "VAT3 bimestral", category: "VAT", periodicity: "bimonthly", status: "active" },
    { client_id: id, name: "Return of Trading Details", category: "VAT", periodicity: "yearly", status: "active" },
    { client_id: id, name: "Corporation tax CT1", category: "CT", periodicity: "yearly", status: "active" },
  ]);

  await semearRh(sb, id, p, rand);

  console.log(`${p.code}  ${p.name}\n   compras ${nC} · vendas ${nV} · banco ${nB} · funcionarios ${p.funcionarios.length}`);
  return { id, code: p.code, name: p.name };
}

/** Folha: configuração, funcionários, horas e o quadro de semanas. */
async function semearRh(sb, id, p, rand) {
  const emLotes = async (tabela, linhas) => {
    for (let i = 0; i < linhas.length; i += 200) {
      await sb.from(tabela).insert(linhas.slice(i, i + 200));
    }
  };

  await sb.from("hr_client").insert({
    client_id: id,
    freq_weekly: p.funcionarios.some((f) => f.freq_type === "weekly"),
    freq_fortnightly: p.funcionarios.some((f) => f.freq_type === "fortnightly"),
    freq_monthly: p.funcionarios.some((f) => f.freq_type === "monthly"),
    er_email: true, ee_channel: "email", auto_submit: false, pays_bank_holiday: true,
    pay_period: "current", week_base: "monday", hours_source: "client",
  });

  for (const f of p.funcionarios) {
    const { data: emp } = await sb.from("hr_employees").insert({
      client_id: id, code: f.code, first_name: f.first_name, surname: f.surname,
      pay_type: f.pay_type, hourly_rate: f.hourly_rate ?? null,
      fixed_amount: f.fixed_amount ?? null, freq_type: f.freq_type,
      contract_type: "Full time", bank_holiday_mode: "pro_rata", data_source: "client",
      holiday_opening: 0, opening_worked: 0, active: true, start_date: `${ANOS[0]}-01-08`,
    }).select("id").single();
    if (!emp || f.pay_type !== "Hourly") continue;

    const horas = [];
    for (const ano of ANOS) {
      for (let w = 1; w <= 52; w++) {
        if (semanaDepoisDeHoje(ano, w)) break;
        horas.push({
          employee_id: emp.id, year: ano, week_no: w,
          hours: r2(37 + Math.round(rand() * 6)),
          sunday_hours: rand() < 0.25 ? 6 : 0,
          holiday_hours: 0, week_worked: true,
        });
      }
    }
    await emLotes("hr_employee_hours", horas);
  }

  const semanas = [];
  for (const ano of ANOS) {
    for (let w = 1; w <= 52; w++) {
      const futura = semanaDepoisDeHoje(ano, w);
      semanas.push({
        client_id: id, year: ano, week_no: w, freq_type: "weekly",
        payslip: futura ? "na" : "done", er: futura ? "na" : "done",
        ee: futura ? "na" : "done", ros: futura ? "na" : "done",
      });
    }
  }
  await emLotes("hr_weeks", semanas);
}

/** A semana ISA já passou? Aproximação por dia do ano, que basta para o seed. */
function semanaDepoisDeHoje(ano, semana) {
  const fim = new Date(Date.UTC(ano, 0, 1 + semana * 7)).toISOString().slice(0, 10);
  return fim > HOJE;
}

// ------------------------------------------------------------- execução

(async function main() {
  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!/localhost|127\.0\.0\.1/.test(String(url))) {
    console.error(`RECUSADO: isto so roda contra localhost. URL=${url}`);
    process.exit(1);
  }
  const sb = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ---- limpar a rodada anterior (só os DEMO-) ----
  const { data: antigos } = await sb.from("clients").select("id,client_code").like("client_code", "DEMO-%");
  for (const c of antigos ?? []) {
    // `ledger_settlements` e `hr_employee_hours` caem por cascata dos pais.
    for (const t of ["ledger_items", "journal", "opening_balances", "bank_transactions",
                     "sales", "invoices", "obligations", "recurring_obligations",
                     "hr_weeks", "hr_employees", "hr_client_config", "hr_client",
                     "bank_accounts", "account_mapping"]) {
      await sb.from(t).delete().eq("client_id", c.id);
    }
    await sb.from("clients").delete().eq("id", c.id);
    console.log(`limpo: ${c.client_code}`);
  }

  /*
   * A empresa do escritorio. Numa instalacao self-host so existe uma; se um
   * dia existirem varias, o seed e de demonstracao e a primeira serve.
   */
  const { data: empresa } = await sb.from("companies")
    .select("id,name").eq("active", true).limit(1).maybeSingle();
  if (!empresa) {
    console.error("Nao ha empresa cadastrada — os clientes ficariam invisiveis na tela.");
    process.exit(1);
  }
  console.log(`empresa: ${empresa.name}\n`);

  const criados = [];
  for (const p of PERFIS) {
    const feito = await semearCliente(sb, p, empresa.id);
    if (feito) criados.push(feito);
  }

  // ---- contabilizar pelo motor de verdade ----
  if (process.argv.includes("--sem-contabilizar")) {
    console.log("\nDocumentos gravados. Falta contabilizar (botao Contabilizar no modulo Fiscal).");
    return;
  }
  console.log("\nContabilizando pelo motor (login + backfill)...");
  const base = process.env.APP_URL || "http://localhost:3000";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // A credencial vem do ambiente e nao do ficheiro: o repositorio e
      // publico, e uma senha escrita aqui ficaria no historico do git para
      // sempre — mesmo que alguem a apague no commit seguinte.
      email: process.env.SEED_EMAIL || "", password: process.env.SEED_PASSWORD || "",
    }),
  }).catch(() => null);

  if (!login || !login.ok) {
    console.log("Nao consegui entrar pela API — os documentos estao gravados, mas o razao ainda nao.");
    console.log("Rode com SEED_EMAIL=... SEED_PASSWORD=... node scripts/seed-demo-clients.js,");
    console.log("ou clique Contabilizar na tela do modulo Fiscal de cada cliente.");
    return;
  }
  const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  for (const c of criados) {
    const r = await fetch(`${base}/api/clients/${c.id}/accounting/backfill`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie }, body: "{}",
    });
    const res = await r.json().catch(() => ({}));
    console.log(`   ${c.code}: notas ${res.notas ?? "?"} · vendas ${res.vendas ?? "?"} · banco ${res.banco ?? "?"} · erros ${(res.erros || []).length}`);
    for (const e of (res.erros || []).slice(0, 3)) console.log(`      ! ${e.doc}: ${e.erro}`);
  }
})();
