import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import {
  calcularInvoice, vencimentoDosTermos, problemasParaEmitir,
  type LinhaDaInvoice, type ProblemaDaInvoice,
} from "./calculo";

/**
 * Emitir uma invoice — e o elo que a faz virar venda.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO QUE SUSTENTA TODO O MÓDULO
 *
 * A invoice emitida **é** a venda. Ao emitir, nasce a linha em `sales` e as
 * `sales_items`, e daí para a frente tudo o que já existe funciona sem saber
 * que isto é novo: o VAT3 apura-a, o contas a receber abre título, a
 * contabilização leva-a ao razão.
 *
 * A alternativa — guardar as invoices à parte e "sincronizar" depois — traria
 * dois números para a mesma realidade e uma rotina de conciliação entre eles.
 * Sistemas assim passam a vida a explicar por que os dois lados não batem.
 * ---------------------------------------------------------------------------
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type ClienteDoCliente = {
  id: string;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  shipAddress: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
};

const doBanco = (c: any): ClienteDoCliente => ({
  id: c.id, name: c.name,
  vatNumber: c.vat_number ?? null, email: c.email ?? null, phone: c.phone ?? null,
  address: c.address ?? null, shipAddress: c.ship_address ?? null,
  country: c.country ?? null, notes: c.notes ?? null, active: c.active !== false,
});

export async function listarClientesDoCliente(
  clientId: string, incluirInativos = false
): Promise<ClienteDoCliente[]> {
  const sb = getServerSupabase();
  let q = sb.from("customers").select("*").eq("client_id", clientId);
  if (!incluirInativos) q = q.eq("active", true);
  const { data } = await q.order("name");
  return ((data ?? []) as any[]).map(doBanco);
}

export type NovoClienteDoCliente = Partial<Omit<ClienteDoCliente, "id">> & { name: string };

export async function guardarClienteDoCliente(
  clientId: string, id: string | null, d: NovoClienteDoCliente
): Promise<{ ok: boolean; cliente?: ClienteDoCliente; erro?: string }> {
  if (!d.name?.trim()) return { ok: false, erro: "O nome é obrigatório." };
  const sb = getServerSupabase();

  const linha = {
    client_id: clientId,
    name: d.name.trim(),
    vat_number: d.vatNumber?.trim() || null,
    email: d.email?.trim() || null,
    phone: d.phone?.trim() || null,
    address: d.address?.trim() || null,
    ship_address: d.shipAddress?.trim() || null,
    country: d.country?.trim() || "Ireland",
    notes: d.notes?.trim() || null,
    active: d.active !== false,
    updated_at: new Date().toISOString(),
  };

  const q = id
    // O `client_id` na condição do update não é decorativo: sem ele, o id de um
    // cliente de outro escritório seria editável por quem tivesse o uuid.
    ? sb.from("customers").update(linha).eq("id", id).eq("client_id", clientId)
    : sb.from("customers").insert(linha);

  const { data, error } = await q.select().single();
  if (error || !data) return { ok: false, erro: error?.message || "Não gravou." };
  return { ok: true, cliente: doBanco(data) };
}

export async function apagarClienteDoCliente(
  clientId: string, id: string
): Promise<{ ok: boolean; erro?: string }> {
  const sb = getServerSupabase();

  /*
   * Um cliente com faturas emitidas NÃO se apaga — inativa-se.
   *
   * A chave estrangeira é `on delete restrict`, então o banco recusaria de
   * qualquer forma, mas com uma mensagem que ninguém entende. Pior do que isso
   * seria o contrário: apagar em cascata levaria consigo faturas emitidas, que
   * são documentos fiscais e têm de existir mesmo depois de o comprador sair.
   */
  const { count } = await sb.from("issued_invoices")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("customer_id", id);

  if (count && count > 0) {
    const { error } = await sb.from("customers")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", id).eq("client_id", clientId);
    if (error) return { ok: false, erro: error.message };
    return {
      ok: false,
      erro: `Este cliente tem ${count} fatura(s) emitida(s), então foi INATIVADO em vez de apagado — `
        + "as faturas são documentos fiscais e têm de continuar a existir. Deixa de aparecer na emissão.",
    };
  }

  const { error } = await sb.from("customers").delete().eq("id", id).eq("client_id", clientId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

// ------------------------------------------------------------------ invoices

export type InvoiceEmitida = {
  id: string;
  number: string;
  status: "draft" | "issued" | "sent" | "cancelled";
  customerId: string | null;
  customerName: string;
  customerVat: string | null;
  customerAddr: string | null;
  customerShip: string | null;
  customerEmail: string | null;
  issueDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  customerRef: string | null;
  notes: string | null;
  net: number;
  vat: number;
  gross: number;
  saleId: string | null;
  sentAt: string | null;
  sentTo: string | null;
  items: {
    id: string; position: number; description: string; detail: string | null;
    quantity: number; unitPrice: number; vatRate: number; net: number; vat: number;
  }[];
};

function invoiceDoBanco(inv: any, items: any[]): InvoiceEmitida {
  return {
    id: inv.id, number: inv.number, status: inv.status,
    customerId: inv.customer_id ?? null,
    customerName: inv.customer_name,
    customerVat: inv.customer_vat ?? null,
    customerAddr: inv.customer_addr ?? null,
    customerShip: inv.customer_ship ?? null,
    customerEmail: inv.customer_email ?? null,
    issueDate: inv.issue_date,
    dueDate: inv.due_date ?? null,
    paymentTerms: inv.payment_terms ?? null,
    customerRef: inv.customer_ref ?? null,
    notes: inv.notes ?? null,
    net: Number(inv.net_amount || 0),
    vat: Number(inv.vat_amount || 0),
    gross: Number(inv.gross_amount || 0),
    saleId: inv.sale_id ?? null,
    sentAt: inv.sent_at ?? null,
    sentTo: inv.sent_to ?? null,
    items: items.map((i) => ({
      id: i.id, position: i.position ?? 0,
      description: i.description, detail: i.detail ?? null,
      quantity: Number(i.quantity || 0), unitPrice: Number(i.unit_price || 0),
      vatRate: Number(i.vat_rate || 0),
      net: Number(i.net_amount || 0), vat: Number(i.vat_amount || 0),
    })).sort((a, b) => a.position - b.position),
  };
}

export async function listarInvoices(clientId: string, limite = 200) {
  const sb = getServerSupabase();
  const { data } = await sb.from("issued_invoices")
    .select("id,number,status,customer_name,issue_date,due_date,net_amount,vat_amount,gross_amount,sale_id,sent_at")
    .eq("client_id", clientId)
    .order("issue_date", { ascending: false }).order("created_at", { ascending: false })
    .limit(limite);
  return ((data ?? []) as any[]).map((i) => ({
    id: i.id, number: i.number, status: i.status,
    customerName: i.customer_name, issueDate: i.issue_date, dueDate: i.due_date ?? null,
    net: Number(i.net_amount || 0), vat: Number(i.vat_amount || 0), gross: Number(i.gross_amount || 0),
    saleId: i.sale_id ?? null, sentAt: i.sent_at ?? null,
  }));
}

export async function lerInvoice(clientId: string, id: string): Promise<InvoiceEmitida | null> {
  const sb = getServerSupabase();
  const { data: inv } = await sb.from("issued_invoices")
    .select("*").eq("id", id).eq("client_id", clientId).maybeSingle();
  if (!inv) return null;
  const { data: items } = await sb.from("issued_invoice_items")
    .select("*").eq("invoice_id", id).order("position");
  return invoiceDoBanco(inv, (items ?? []) as any[]);
}

export type RascunhoDaInvoice = {
  customerId?: string | null;
  customerName?: string | null;
  customerVat?: string | null;
  customerAddr?: string | null;
  customerShip?: string | null;
  customerEmail?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  paymentTerms?: string | null;
  customerRef?: string | null;
  notes?: string | null;
  items?: LinhaDaInvoice[];
};

/**
 * Grava (ou cria) um rascunho.
 *
 * O rascunho NÃO consome número da sequência. Um número gasto num rascunho que
 * é depois abandonado abre um buraco na numeração — e um buraco na numeração de
 * faturas é achado de auditoria de VAT, que é justamente o que este módulo
 * existe para evitar.
 */
export async function guardarRascunho(
  clientId: string, id: string | null, d: RascunhoDaInvoice, userId?: string | null
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const sb = getServerSupabase();
  const linhas = (d.items ?? []).filter((l) => l.description?.trim());
  const t = calcularInvoice(linhas);
  const emissao = d.issueDate || new Date().toISOString().slice(0, 10);

  const cabecalho = {
    client_id: clientId,
    customer_id: d.customerId || null,
    customer_name: d.customerName?.trim() || "(sem cliente)",
    customer_vat: d.customerVat?.trim() || null,
    customer_addr: d.customerAddr?.trim() || null,
    customer_ship: d.customerShip?.trim() || null,
    customer_email: d.customerEmail?.trim() || null,
    issue_date: emissao,
    // A data de vencimento sai dos termos quando ninguém a escreveu à mão. Se
    // os termos não trouxerem prazo, fica nula — ver vencimentoDosTermos.
    due_date: d.dueDate || vencimentoDosTermos(emissao, d.paymentTerms),
    payment_terms: d.paymentTerms?.trim() || null,
    customer_ref: d.customerRef?.trim() || null,
    notes: d.notes?.trim() || null,
    net_amount: t.net, vat_amount: t.vat, gross_amount: t.gross,
    updated_at: new Date().toISOString(),
  };

  let invoiceId = id;
  if (id) {
    /*
     * Uma fatura já emitida não se edita.
     *
     * Foi para as mãos do comprador, entrou no VAT e abriu título a receber.
     * Mudar-lhe o valor aqui deixaria três versões da mesma fatura — a que o
     * cliente tem em PDF, a que está no razão, e esta. Corrige-se anulando e
     * emitindo outra, que é o que a lei espera.
     */
    const { data: atual } = await sb.from("issued_invoices")
      .select("status").eq("id", id).eq("client_id", clientId).maybeSingle();
    if (!atual) return { ok: false, erro: "Fatura não encontrada." };
    if ((atual as any).status !== "draft") {
      return { ok: false, erro: "Esta fatura já foi emitida e não se edita. Anule-a e emita outra." };
    }
    const { error } = await sb.from("issued_invoices").update(cabecalho)
      .eq("id", id).eq("client_id", clientId);
    if (error) return { ok: false, erro: error.message };
  } else {
    const { data, error } = await sb.from("issued_invoices")
      // O número do rascunho é um marcador, e vê-se que é: quem olha para a
      // lista percebe logo que ainda não é uma fatura.
      .insert({ ...cabecalho, number: `RASCUNHO-${Date.now().toString(36).toUpperCase()}`, status: "draft", created_by: userId ?? null })
      .select("id").single();
    if (error || !data) return { ok: false, erro: error?.message || "Não gravou." };
    invoiceId = (data as any).id;
  }

  // As linhas são reescritas por inteiro. Um `upsert` linha a linha teria de
  // resolver reordenação e remoção, e é aí que ficam linhas fantasma.
  await sb.from("issued_invoice_items").delete().eq("invoice_id", invoiceId!);
  if (t.linhas.length) {
    await sb.from("issued_invoice_items").insert(t.linhas.map((l, i) => ({
      invoice_id: invoiceId, position: i,
      description: l.description.trim(), detail: l.detail?.trim() || null,
      quantity: l.quantity, unit_price: l.unitPrice, vat_rate: l.vatRate,
      net_amount: l.net, vat_amount: l.vat,
    })));
  }

  return { ok: true, id: invoiceId! };
}

export type ResultadoDaEmissao =
  | { ok: true; invoice: InvoiceEmitida }
  | { ok: false; erro?: string; problemas?: ProblemaDaInvoice[] };

/**
 * EMITE: dá número definitivo à fatura e transforma-a em venda.
 *
 * A ordem é deliberada — validar, numerar, gravar a venda, marcar a fatura.
 * Se a venda falhar depois de o número sair, a sequência já avançou e fica um
 * buraco; por isso a venda é a última coisa que pode falhar, e a fatura só
 * passa a `issued` depois de ela existir.
 */
export async function emitirInvoice(
  clientId: string, id: string
): Promise<ResultadoDaEmissao> {
  const sb = getServerSupabase();

  const inv = await lerInvoice(clientId, id);
  if (!inv) return { ok: false, erro: "Fatura não encontrada." };
  if (inv.status !== "draft") return { ok: false, erro: "Esta fatura já foi emitida." };

  const { data: cliente } = await sb.from("clients")
    .select("vat_number").eq("id", clientId).maybeSingle();

  const linhas: LinhaDaInvoice[] = inv.items.map((i) => ({
    description: i.description, detail: i.detail,
    quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate,
  }));

  const problemas = problemasParaEmitir({
    customerName: inv.customerName === "(sem cliente)" ? "" : inv.customerName,
    issueDate: inv.issueDate,
    linhas,
    vendedorTemVat: Boolean((cliente as any)?.vat_number?.trim()),
  });
  if (problemas.length) return { ok: false, problemas };

  const t = calcularInvoice(linhas);

  // O número sai da função do banco, que tranca a linha da sequência. Ver
  // selfhost/schema/036_invoicing.sql.
  const ano = Number(inv.issueDate.slice(0, 4));
  const { data: numero, error: eNum } = await sb.rpc("proximo_numero_invoice", {
    p_client_id: clientId, p_year: ano, p_prefix: "INV",
  });
  if (eNum || !numero) return { ok: false, erro: eNum?.message || "Não deu para gerar o número." };

  /*
   * A VENDA. É isto que liga a fatura ao resto do sistema.
   *
   * A alíquota do cabeçalho é a da linha de maior valor — `sales.vat_rate` é
   * uma coluna só, e uma fatura pode ter várias. O detalhe verdadeiro fica em
   * `sales_items`, que é de onde a apuração por alíquota lê.
   */
  const taxaPrincipal = t.porTaxa.slice().sort((a, b) => b.net - a.net)[0]?.rate ?? 0;
  const { data: venda, error: eVenda } = await sb.from("sales").insert({
    client_id: clientId,
    entry_date: inv.issueDate,
    doc_number: numero,
    customer: inv.customerName,
    net_amount: t.net,
    vat_rate: taxaPrincipal,
    vat_amount: t.vat,
    notes: `Fatura emitida pelo ERP${inv.customerRef ? ` · ref. ${inv.customerRef}` : ""}`,
  }).select("id").single();
  if (eVenda || !venda) return { ok: false, erro: eVenda?.message || "Não gravou a venda." };

  const saleId = (venda as any).id;
  if (t.linhas.length) {
    await sb.from("sales_items").insert(t.linhas.map((l) => ({
      sale_id: saleId,
      description: l.description.trim(),
      quantity: l.quantity, unit_price: l.unitPrice,
      net_amount: l.net, vat_rate: l.vatRate, vat_amount: l.vat,
    })));
  }

  const { error: eFim } = await sb.from("issued_invoices").update({
    number: numero, status: "issued", sale_id: saleId,
    issued_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    net_amount: t.net, vat_amount: t.vat, gross_amount: t.gross,
  }).eq("id", id).eq("client_id", clientId);

  if (eFim) {
    // A venda existe e a fatura não conseguiu apontar para ela: desfaz-se a
    // venda, senão ficava uma venda órfã no VAT que ninguém sabe de onde veio.
    await sb.from("sales").delete().eq("id", saleId);
    return { ok: false, erro: eFim.message };
  }

  return { ok: true, invoice: (await lerInvoice(clientId, id))! };
}

/**
 * ANULA uma fatura emitida.
 *
 * Não apaga: uma fatura emitida existiu, foi para fora, e o número dela não
 * pode ser reutilizado nem desaparecer da sequência. Fica `cancelled`, com a
 * venda desfeita para não continuar a contar no VAT.
 */
export async function anularInvoice(
  clientId: string, id: string
): Promise<{ ok: boolean; erro?: string }> {
  const sb = getServerSupabase();
  const inv = await lerInvoice(clientId, id);
  if (!inv) return { ok: false, erro: "Fatura não encontrada." };
  if (inv.status === "cancelled") return { ok: false, erro: "Esta fatura já está anulada." };
  if (inv.status === "draft") return { ok: false, erro: "Um rascunho apaga-se, não se anula." };

  if (inv.saleId) {
    /*
     * A venda só sai se ainda não tiver sido contabilizada nem baixada.
     *
     * `deleteSalesEntry` já sabe verificar isso (é a mesma trava do "devolver"),
     * e reusá-la é o que impede esta rota de ser um atalho para apagar uma
     * venda que o razão e o contas a receber ainda referenciam.
     */
    const { deleteSalesEntry } = await import("@/lib/store");
    const r = await deleteSalesEntry(inv.saleId);
    if (!r.ok) {
      return {
        ok: false,
        erro: `Não dá para anular enquanto a venda estiver integrada: ${r.erro} `
          + "Devolva o documento primeiro, em Vendas.",
      };
    }
  }

  const { error } = await sb.from("issued_invoices")
    .update({ status: "cancelled", sale_id: null, updated_at: new Date().toISOString() })
    .eq("id", id).eq("client_id", clientId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

export async function apagarRascunho(
  clientId: string, id: string
): Promise<{ ok: boolean; erro?: string }> {
  const sb = getServerSupabase();
  const { data: inv } = await sb.from("issued_invoices")
    .select("status").eq("id", id).eq("client_id", clientId).maybeSingle();
  if (!inv) return { ok: false, erro: "Fatura não encontrada." };
  if ((inv as any).status !== "draft") {
    return { ok: false, erro: "Só rascunhos se apagam. Uma fatura emitida anula-se, para o número não sumir da sequência." };
  }
  const { error } = await sb.from("issued_invoices").delete().eq("id", id).eq("client_id", clientId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

export { r2 };

/**
 * Quem EMITE a fatura, montado a partir do cadastro do cliente.
 *
 * Vive aqui e não na tela porque o PDF é gerado no servidor, e porque a mesma
 * informação alimenta o e-mail. Duas montagens da mesma coisa divergiriam no
 * dia em que alguém acrescentasse um campo a uma delas.
 */
export async function emitenteDoCliente(clientId: string) {
  const sb = getServerSupabase();
  const { data: c } = await sb.from("clients")
    .select("name,trading_name,address,phone,email,vat_number,cro,logo_path,invoice_footer,invoice_bank_account_id,legal_form,director")
    .eq("id", clientId).maybeSingle();
  if (!c) return null;
  const cli = c as any;

  const linhas: string[] = [];
  // A morada vem num campo só, com quebras: ver o comentário em customers.
  for (const l of String(cli.address ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean)) linhas.push(l);
  if (cli.phone) linhas.push(cli.phone);
  if (cli.email) linhas.push(cli.email);

  let logo: { bytes: Buffer; mime: string } | null = null;
  if (cli.logo_path) {
    const { data } = await sb.storage.from("documents").download(cli.logo_path);
    if (data) {
      logo = {
        bytes: Buffer.from(await data.arrayBuffer()),
        mime: cli.logo_path.endsWith(".png") ? "image/png" : "image/jpeg",
      };
    }
  }

  let banco: { nome: string | null; iban: string | null; bic: string | null } | null = null;
  if (cli.invoice_bank_account_id) {
    const { data: b } = await sb.from("bank_accounts")
      .select("name,bank_name,account_ref").eq("id", cli.invoice_bank_account_id)
      .eq("client_id", clientId).maybeSingle();
    if (b) {
      banco = {
        nome: (b as any).bank_name || (b as any).name || null,
        iban: (b as any).account_ref || null,
        bic: null,
      };
    }
  }

  /*
   * O rodapé legal por omissão.
   *
   * Uma sociedade irlandesa é obrigada a mostrar o número no CRO e os diretores
   * na papelada que emite. Se o escritório não escreveu um rodapé próprio,
   * monta-se um com o que o cadastro já sabe — melhor um rodapé montado do que
   * uma fatura de sociedade sem a menção obrigatória.
   *
   * Um sole trader não tem esta obrigação, e por isso não leva rodapé nenhum.
   */
  let rodape: string | null = cli.invoice_footer?.trim() || null;
  if (!rodape && cli.legal_form === "limited_company" && cli.cro) {
    rodape = `${cli.name} is registered in Ireland (No. ${cli.cro}).`
      + (cli.director ? ` Directors: ${cli.director}.` : "");
  }

  return {
    nome: cli.trading_name?.trim() || cli.name,
    linhas,
    vatNumber: cli.vat_number?.trim() || null,
    logo,
    rodapeLegal: rodape,
    banco,
  };
}

/** Marca a fatura como enviada, e para quem. */
export async function marcarEnviada(
  clientId: string, id: string, para: string
): Promise<void> {
  const sb = getServerSupabase();
  await sb.from("issued_invoices").update({
    // `sent` só substitui `issued`: uma fatura anulada que alguém reenviasse
    // por engano não pode voltar a parecer viva.
    status: "sent", sent_at: new Date().toISOString(), sent_to: para,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("client_id", clientId).in("status", ["issued", "sent"]);
}
