import { NextRequest, NextResponse } from "next/server";
import { listInboxItems, type InboxStatus } from "@/lib/mailStore";
import { canSeeUnroutedMail, denied, requireClient, visibleClientIds } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: InboxStatus[] = ["pending", "read", "saved", "duplicate", "refused", "discarded"];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("client") || undefined;
  const status = (searchParams.get("status") || "")
    .split(",").filter((s): s is InboxStatus => (VALID as string[]).includes(s));
  const allowed = await visibleClientIds();
  if (allowed && "error" in allowed) return allowed.error;
  if (clientId) {
    const access = await requireClient(clientId);
    if (denied(access)) return access.error;
  }
  return NextResponse.json({
    items: await listInboxItems({
      clientId, status, allowedClientIds: allowed,
      includeUnrouted: await canSeeUnroutedMail(),
    }),
  });
}
