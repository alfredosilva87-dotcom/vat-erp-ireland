// =====================================================================
// Bright / BrightBooks (Surf Accounts) — camada de CONECTOR (API)
// ---------------------------------------------------------------------
// STUB pronto para plugar. A Surf/Bright NÃO tem API pública/documentada:
// a API existe mas é usada internamente pelos produtos da própria Bright
// (BrightPay etc.) e o acesso é liberado caso a caso (partner-gated).
//
// Enquanto o acesso não é concedido, todos os métodos retornam
// { ok:false, reason:"api_not_available" } e o app usa a ponte por CSV
// (lib/brightExport.ts). Quando a Bright liberar credenciais/endpoints,
// basta implementar os TODOs em SurfConnector — a interface e as rotas
// que consomem já estão prontas.
// =====================================================================

export interface BrightCredentials {
  // Surf autentica com usuário/senha da conta (modelo observado nos
  // produtos Bright). Guardar por cliente quando a API for liberada.
  username?: string;
  password?: string;
  baseUrl?: string; // ex.: https://ap.surfaccounts.com
  apiKey?: string; // caso a Bright forneça chave em vez de user/senha
}

export type PushResultReason =
  | "ok"
  | "api_not_available" // sem acesso liberado pela Bright
  | "not_configured" // credenciais ausentes
  | "auth_failed"
  | "network_error"
  | "rejected";

export interface PushResult {
  ok: boolean;
  reason: PushResultReason;
  message: string;
  reference?: string | null; // id/ref retornado pelo Surf quando existir
  raw?: unknown;
}

export interface NominalAccount {
  code: string;
  name: string;
}

/** Contrato que qualquer conector Bright deve cumprir. */
export interface BrightConnector {
  readonly configured: boolean;
  /** Testa autenticação/estado. */
  testConnection(): Promise<PushResult>;
  /** Puxa os nominal ledger codes do Surf (para o de-para de contas). */
  listNominalAccounts(): Promise<NominalAccount[]>;
  /** Envia contatos (fornecedores/clientes). */
  pushContacts(rows: unknown[]): Promise<PushResult>;
  /** Envia notas de compra (ou journals) já mapeadas. */
  pushPurchaseInvoices(rows: unknown[]): Promise<PushResult>;
}

const NOT_AVAILABLE: PushResult = {
  ok: false,
  reason: "api_not_available",
  message:
    "The BrightBooks/Surf API isn't publicly available. Partner access from Bright is required. Use the CSV export in the meantime.",
  reference: null,
};

/** Implementação real (a completar quando a Bright liberar acesso). */
export class SurfConnector implements BrightConnector {
  private creds: BrightCredentials;
  constructor(creds: BrightCredentials = {}) {
    this.creds = creds;
  }

  get configured(): boolean {
    const c = this.creds;
    return Boolean((c.username && c.password) || c.apiKey);
  }

  async testConnection(): Promise<PushResult> {
    if (!this.configured) {
      return { ok: false, reason: "not_configured", message: "Surf credentials not configured." };
    }
    // TODO: quando houver API — autenticar em `${baseUrl}/...` e validar sessão.
    return NOT_AVAILABLE;
  }

  async listNominalAccounts(): Promise<NominalAccount[]> {
    // TODO: GET nominal ledger codes; hoje vazio (sem API).
    return [];
  }

  async pushContacts(_rows: unknown[]): Promise<PushResult> {
    // TODO: POST contatos quando a API existir.
    return NOT_AVAILABLE;
  }

  async pushPurchaseInvoices(_rows: unknown[]): Promise<PushResult> {
    // TODO: POST notas/journals quando a API existir.
    return NOT_AVAILABLE;
  }
}

/**
 * Factory. Hoje sempre devolve o SurfConnector (que responde
 * "api_not_available"). Quando houver storage de credenciais por cliente
 * (ver db/bright_connections.sql), carregue-as aqui.
 */
export function getBrightConnector(creds: BrightCredentials = {}): BrightConnector {
  return new SurfConnector(creds);
}
