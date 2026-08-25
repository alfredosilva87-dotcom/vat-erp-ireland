import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A própria conta: dados pessoais, foto e senha.
 *
 * Sem guarda de empresa de propósito, e é seguro pela forma: a rota nunca lê um
 * id do pedido. Escreve SEMPRE em `getSessionUser().id`, então o pior que um
 * corpo adulterado consegue é o utilizador mudar o próprio nome. É a mesma
 * razão pela qual `/api/auth/me` está dispensado do guarda.
 *
 * Perfil e permissão são coisas separadas: nada aqui toca em `role`, `active`
 * nem `screen_access`. Quem muda isso é um administrador, na tela de
 * utilizadores — senão qualquer pessoa se promovia a administrador editando o
 * próprio perfil.
 */

/**
 * Teto da foto, em caracteres do data URL.
 *
 * ~700 KB de texto, que dá uma imagem de ~500 KB depois do base64. A tela já
 * reduz para 256px antes de enviar, então este número não é o esperado: é o
 * limite para o caso de alguém chamar a rota por fora. Sem ele, um retrato de
 * telemóvel de 8 MB entrava na coluna e passava a viajar em toda chamada de
 * `/api/auth/me` — a tela ficaria lenta sem ninguém saber porquê.
 */
const MAX_AVATAR = 700_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data } = await getServerSupabase()
    .from("app_users")
    .select("id,email,name,surname,phone,avatar,role,created_at")
    .eq("id", user.id)
    .maybeSingle();
  return NextResponse.json({ profile: data ?? null });
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  if ("name" in body) patch.name = texto(body.name);
  if ("surname" in body) patch.surname = texto(body.surname);
  if ("phone" in body) patch.phone = texto(body.phone);

  if ("avatar" in body) {
    const a = body.avatar;
    if (a === null || a === "") {
      patch.avatar = null;
    } else if (typeof a !== "string" || !/^data:image\/(png|jpeg|webp);base64,/.test(a)) {
      return NextResponse.json(
        { error: "The photo must be a PNG, JPEG or WEBP image." }, { status: 400 }
      );
    } else if (a.length > MAX_AVATAR) {
      return NextResponse.json(
        { error: "That photo is too large. Choose a smaller one." }, { status: 400 }
      );
    } else {
      patch.avatar = a;
    }
  }

  if (body.password) {
    const pw = String(body.password);
    if (pw.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." }, { status: 400 }
      );
    }
    patch.password_hash = await bcrypt.hash(pw, 10);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const { data, error } = await getServerSupabase()
    .from("app_users")
    .update(patch)
    .eq("id", user.id)
    .select("id,email,name,surname,phone,avatar,role")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
