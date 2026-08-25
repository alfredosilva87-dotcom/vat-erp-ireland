// Agrupamento das rotinas do workspace de cliente em módulos (estilo ERP por
// módulo). Cada segmento de URL pertence a no máximo um módulo; "dashboard"
// fica de fora de propósito — é o "home" do cliente, sempre visível.
import type { TKey } from "./i18n/en";

export type ModuleKey =
  | "vendas" | "compras" | "financeiro" | "contabilidade" | "fiscal" | "cadastro";

export type ModuleItem = { seg: string; key: TKey };

export type ModuleDef = {
  key: ModuleKey;
  labelKey: TKey;
  items: ModuleItem[];
};

export const MODULES: ModuleDef[] = [
  {
    key: "vendas",
    labelKey: "modules.vendas",
    items: [{ seg: "sales", key: "client.tabSales" }],
  },
  {
    key: "compras",
    labelKey: "modules.compras",
    items: [
      { seg: "purchases", key: "client.tabPurchases" },
      { seg: "analyze", key: "client.tabAnalyze" },
      { seg: "inbox", key: "client.tabInbox" },
      { seg: "suppliers", key: "client.tabSuppliers" },
    ],
  },
  {
    key: "financeiro",
    labelKey: "modules.financeiro",
    items: [
      { seg: "bank", key: "client.tabBank" },
      { seg: "payable", key: "client.tabPayable" },
      // O outro lado do mesmo modelo: o título de venda. Ver
      // components/financial/TitlesView.tsx — uma tela serve os dois.
      { seg: "receivable", key: "client.tabReceivable" },
    ],
  },
  {
    /*
     * A contabilidade saiu do Fiscal e virou módulo.
     *
     * Estava ali por vizinhança de calendário — o VAT e o fecho olham os
     * mesmos meses —, mas são ofícios diferentes: o Fiscal apura imposto e
     * entrega declaração; a contabilidade mantém o razão e produz as
     * demonstrações. Quem passa o dia num não abre o outro, e um módulo que
     * junta os dois obriga sempre metade das pessoas a atravessar telas que
     * não são suas para chegar às que são.
     */
    key: "contabilidade",
    labelKey: "modules.contabilidade",
    items: [
      // O plano de contas saiu do Financeiro. Ele é a espinha da contabilidade:
      // é dele que saem as rubricas do balanço e do DRE, e quem mexe nele está
      // a fazer trabalho contábil, não financeiro.
      { seg: "accounts", key: "client.tabAccounts" },
      // Balancete, DRE e balanço — a leitura do razão.
      { seg: "accounting", key: "client.tabAccounting" },
      // E o próprio razão. Telas separadas porque o uso é outro: aquela é de
      // FECHO e olha o exercício; esta é de CONCILIAÇÃO e olha uma janela de
      // datas, uma conta de cada vez.
      { seg: "ledger", key: "client.tabLedger" },
    ],
  },
  {
    key: "fiscal",
    labelKey: "modules.fiscal",
    items: [
      { seg: "obligations", key: "client.tabObligations" },
      { seg: "vat", key: "client.tabVat" },
      // Entrada e saída na mesma linha do tempo, com o exportador do período.
      // Fica no Fiscal porque o período que interessa é o do VAT, e porque
      // nem Compras nem Vendas sozinhas dão conta de uma tela que é dos dois.
      { seg: "documents", key: "client.tabDocuments" },
    ],
  },
  // O RH saiu daqui. A folha de pagamento é do ESCRITÓRIO, não de um cliente:
  // o painel, o controlo semanal e a comunicação olham as 35 empresas de uma
  // vez. Vive agora no menu geral — ver HR_SCREENS em lib/permissions.ts.
  {
    key: "cadastro",
    labelKey: "modules.cadastro",
    items: [
      { seg: "settings", key: "client.tabSettings" },
      { seg: "bright", key: "client.tabBright" },
    ],
  },
];

/** A que módulo pertence um segmento de URL, ou `null` (ex.: "dashboard"). */
export function moduleForSeg(seg: string): ModuleDef | null {
  return MODULES.find((m) => m.items.some((i) => i.seg === seg)) ?? null;
}

// Quem pode ver o quê saiu daqui: a permissão hoje é por TELA, e mora em
// lib/permissions.ts (grantsScreen/grantsGroup/grantsSeg). Este arquivo voltou
// a ser só o mapa das rotinas — o que existe, e sob qual módulo.
