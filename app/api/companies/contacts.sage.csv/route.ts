import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listClients } from "@/lib/store";
import { buildSageContactsCsv } from "@/lib/exportSage";

export const runtime = "nodejs";

// Contacts is a master-data snapshot (all of the signed-in company's
// clients), not scoped to one client and not period-bound like the other
// exports — any signed-in member of the tenant can pull it.
export async function GET() {
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;

  const clients = await listClients(undefined, guard.user.company_id);
  const file = buildSageContactsCsv(clients);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = file.name.replace(/\.csv$/, `_${stamp}.csv`);

  return new NextResponse("﻿" + file.content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
