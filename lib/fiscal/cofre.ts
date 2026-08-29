import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { validadeDe, mimeAceite, type DocumentoDoCliente } from "./cofreTipos";

/**
 * O cofre de documentos DO CLIENTE.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE COFRE GUARDA, E O QUE NÃO
 *
 * O sistema já guardava documentos FISCAIS — a nota de compra, a venda, o
 * extrato. Este guarda os documentos da EMPRESA: identidade do titular,
 * comprovativo de morada, pacto social, certidões.
 *
 * São os que o escritório tem de apresentar quando alguém pergunta — a Revenue,
 * o banco, uma auditoria — e hoje vivem numa pasta partilhada fora do sistema.
 * Uma pasta partilhada não sabe a que cliente pertence cada ficheiro, não sabe
 * quando o documento caduca, e não desaparece quando o cliente sai.
 * ---------------------------------------------------------------------------
 *
 * `expires_on` é a razão de isto ser mais do que uma lista de anexos: um
 * documento de identidade CADUCA, e um cliente com identificação expirada é um
 * problema de compliance que não avisa sozinho.
 */

export {
  TIPOS_DE_DOCUMENTO, DIAS_AVISO_VALIDADE, MIMES_ACEITES, validadeDe, mimeAceite,
  type TipoDeDocumento, type DocumentoDoCliente,
} from "./cofreTipos";

const BUCKET = "documents";
/** Onde os ficheiros do cofre vivem, separados dos documentos fiscais. */
const PASTA = "client-docs";

export async function listarDocumentos(clientId: string): Promise<DocumentoDoCliente[]> {
  const sb = getServerSupabase();
  const { data } = await sb.from("client_documents")
    .select("id,kind,title,original_filename,mime_type,size_bytes,issued_on,expires_on,notes,created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  const hoje = new Date().toISOString().slice(0, 10);
  return ((data ?? []) as any[]).map((d) => {
    const v = validadeDe(d.expires_on ?? null, hoje);
    return {
      id: d.id, kind: d.kind, title: d.title ?? null,
      originalFilename: d.original_filename ?? null,
      mimeType: d.mime_type ?? null,
      sizeBytes: d.size_bytes ?? null,
      issuedOn: d.issued_on ?? null,
      expiresOn: d.expires_on ?? null,
      notes: d.notes ?? null,
      createdAt: d.created_at,
      validade: v.validade,
      diasParaCaducar: v.dias,
    };
  });
}

export type NovoDocumento = {
  clientId: string;
  kind: string;
  title?: string | null;
  bytes: Buffer;
  originalFilename: string;
  mimeType: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  notes?: string | null;
  userId?: string | null;
};

export async function guardarDocumento(
  d: NovoDocumento
): Promise<{ ok: boolean; id?: string; erro?: string }> {
  const sb = getServerSupabase();

  /*
   * A recusa acontece ANTES de o ficheiro tocar no armazenamento.
   *
   * O cofre serve os ficheiros para dentro da aplicação: um HTML aceite aqui
   * seria renderizado na origem do ERP, com a sessão de quem o abrisse ao
   * alcance do script. Ver MIMES_ACEITES em cofreTipos.ts.
   */
  if (!mimeAceite(d.mimeType)) {
    return { ok: false, erro: `Só se aceita PDF ou imagem. Este ficheiro é ${d.mimeType || "de tipo desconhecido"}.` };
  }

  /*
   * O caminho no armazenamento leva o id do cliente e um id próprio.
   *
   * Nunca o nome original: dois clientes com "passaporte.pdf" escreveriam um
   * por cima do outro, e um nome vindo de fora pode trazer `../` e sair da
   * pasta. O nome que a pessoa vê fica na coluna `original_filename`.
   */
  const ext = (d.originalFilename.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || "bin").toLowerCase();
  const id = crypto.randomUUID();
  const path = `${PASTA}/${d.clientId}/${id}.${ext}`;

  const { error: eUp } = await sb.storage.from(BUCKET)
    .upload(path, d.bytes, { contentType: d.mimeType, upsert: false });
  if (eUp) return { ok: false, erro: eUp.message };

  const { data, error } = await sb.from("client_documents").insert({
    client_id: d.clientId,
    kind: d.kind,
    title: d.title?.trim() || null,
    storage_path: path,
    original_filename: d.originalFilename,
    mime_type: d.mimeType,
    size_bytes: d.bytes.length,
    issued_on: d.issuedOn || null,
    expires_on: d.expiresOn || null,
    notes: d.notes?.trim() || null,
    uploaded_by: d.userId ?? null,
  }).select("id").single();

  if (error || !data) {
    // A linha não vingou: o ficheiro sai também. Ao contrário ficaria um
    // ficheiro no armazenamento que nada referencia e ninguém encontra.
    try { await sb.storage.from(BUCKET).remove([path]); } catch { /* nada a fazer */ }
    return { ok: false, erro: error?.message || "Nao gravou o documento." };
  }
  return { ok: true, id: (data as any).id };
}

export async function baixarDocumento(
  clientId: string, docId: string
): Promise<{ bytes: Buffer; mime: string; filename: string; inline: boolean } | null> {
  const sb = getServerSupabase();
  // O cliente entra na consulta: sem ele, o id de um documento de outro
  // escritorio seria descarregado por quem tivesse o id.
  const { data: doc } = await sb.from("client_documents")
    .select("storage_path,mime_type,original_filename")
    .eq("id", docId).eq("client_id", clientId).maybeSingle();
  if (!doc) return null;

  const { data, error } = await sb.storage.from(BUCKET).download((doc as any).storage_path);
  if (error || !data) return null;

  /*
   * Segunda trava, na saída.
   *
   * A entrada já filtra, mas isto é o que decide o que o NAVEGADOR faz com os
   * bytes — e as duas coisas devem valer por si. Um ficheiro gravado antes
   * desta regra, ou por outro caminho, não deve ganhar direito a renderizar
   * só por estar guardado.
   */
  const guardado = (doc as any).mime_type as string | null;
  const seguro = mimeAceite(guardado);
  return {
    bytes: Buffer.from(await data.arrayBuffer()),
    mime: seguro ? (guardado as string) : "application/octet-stream",
    filename: (doc as any).original_filename || "documento",
    /** Só o que é seguro abre no navegador; o resto descarrega. */
    inline: seguro,
  };
}

export async function apagarDocumento(
  clientId: string, docId: string
): Promise<{ ok: boolean; erro?: string }> {
  const sb = getServerSupabase();
  const { data: doc } = await sb.from("client_documents")
    .select("storage_path").eq("id", docId).eq("client_id", clientId).maybeSingle();
  if (!doc) return { ok: false, erro: "Documento nao encontrado." };

  const { error } = await sb.from("client_documents")
    .delete().eq("id", docId).eq("client_id", clientId);
  if (error) return { ok: false, erro: error.message };

  // A linha sai primeiro: se o ficheiro falhar a apagar, fica um órfão no
  // armazenamento — chato, mas invisível. Ao contrário ficaria uma linha a
  // apontar para um ficheiro que já não existe, e essa a pessoa clica.
  try { await sb.storage.from(BUCKET).remove([(doc as any).storage_path]); } catch { /* orfao */ }
  return { ok: true };
}
