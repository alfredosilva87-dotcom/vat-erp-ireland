import { NextRequest, NextResponse } from "next/server";
import { denied, requireClient } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { colunasDaCelula } from "@/lib/hr/lancamentoDeHoras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LANÇAR HORAS À MÃO — a porta que não existia.
 *
 * ---------------------------------------------------------------------------
 * O QUE HAVIA ANTES DISTO
 *
 * Nada. O quadro "Time worked" mostrava as horas e não aceitava uma tecla: 499
 * linhas de ecrã, oito separadores, **zero campos de entrada e zero chamadas de
 * escrita**. As horas só entravam por duas portas — o CSV, e a fila do que o
 * cliente manda.
 *
 * É a mesma classe de buraco que já mordeu este sistema duas vezes: o
 * funcionário que só se criava por SQL, e a compra que só entrava pela leitura
 * automática. A pergunta que a evita é sempre a mesma — *o que cria a primeira
 * linha desta tabela?* Se a resposta não for um ecrã, falta um ecrã.
 *
 * ---------------------------------------------------------------------------
 * UMA CÉLULA DE CADA VEZ, E PORQUÊ
 *
 * O quadro é funcionários × semanas. Gravar a grelha inteira a cada tecla
 * mandaria dezenas de linhas para o servidor por causa de um número; gravar só
 * no fim perderia trabalho a quem fechasse o separador.
 *
 * Uma célula é a unidade que o utilizador tem na cabeça — "a semana 34 do
 * João" — e é a unidade em que ele corrige. Também é a única em que duas
 * pessoas a trabalhar ao mesmo tempo não se pisam.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO MEXE EM PERÍODO FECHADO
 *
 * Não porque esta rota o verifique — mas porque as horas alimentam a folha, e
 * a folha fechada é `final`. Reabrir é um acto próprio, com o seu botão. Aqui
 * recusa-se apenas o que é obviamente impossível.
 */

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const b = await req.json().catch(() => ({}));
  const employeeId = String(b?.employeeId ?? "").trim();
  const year = Number(b?.year);
  const weekNo = Number(b?.weekNo);

  if (!employeeId) return NextResponse.json({ error: "Falta o funcionário." }, { status: 400 });
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Ano inválido." }, { status: 400 });
  }
  if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 53) {
    return NextResponse.json({ error: "Semana inválida." }, { status: 400 });
  }

  const sb = getServerSupabase();

  /*
   * O funcionário TEM de ser deste cliente.
   *
   * O `requireClient` acima confere o acesso ao cliente; sem esta segunda
   * pergunta, um id de funcionário de outra empresa no corpo do pedido
   * escrevia horas na folha dela. É a mesma armadilha que a rota `/hr/weeks`
   * já documenta.
   */
  const { data: emp } = await sb.from("hr_employees")
    .select("id").eq("id", employeeId).eq("client_id", params.id).maybeSingle();
  if (!emp) return NextResponse.json({ error: "Funcionário não encontrado neste cliente." }, { status: 404 });

  const user = await getSessionUser();
  const linha: Record<string, any> = {
    employee_id: employeeId,
    year,
    week_no: weekNo,
    updated_by: user?.id ?? null,
  };
  // Só se escreve o que veio no pedido. Assim uma tela que edita as horas não
  // apaga sem querer o domingo que outra pessoa lançou na mesma célula.
  Object.assign(linha, colunasDaCelula(b));

  const { data, error } = await sb.from("hr_employee_hours")
    .upsert(linha, { onConflict: "employee_id,year,week_no" })
    .select().maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, hora: data });
}

/**
 * Apagar a célula.
 *
 * Não é o mesmo que pôr zero: zero é "trabalhou zero horas" — uma afirmação —,
 * e apagar é "não há registo desta semana". A folha lê os dois de maneira
 * diferente, e o quadro mostra `—` num e `0` no outro.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const employeeId = String(sp.get("employeeId") ?? "");
  const year = Number(sp.get("year"));
  const weekNo = Number(sp.get("weekNo"));
  if (!employeeId || !Number.isInteger(year) || !Number.isInteger(weekNo)) {
    return NextResponse.json({ error: "Pedido incompleto." }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: emp } = await sb.from("hr_employees")
    .select("id").eq("id", employeeId).eq("client_id", params.id).maybeSingle();
  if (!emp) return NextResponse.json({ error: "Funcionário não encontrado neste cliente." }, { status: 404 });

  const { error } = await sb.from("hr_employee_hours")
    .delete().eq("employee_id", employeeId).eq("year", year).eq("week_no", weekNo);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
