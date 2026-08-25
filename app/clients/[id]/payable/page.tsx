"use client";

import TitlesView from "@/components/financial/TitlesView";
import { useT } from "@/lib/i18n";

/** Contas a pagar. A tela mora em components/financial/TitlesView.tsx. */
export default function Payable({ params }: { params: { id: string } }) {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("payable.title")}</h1>
        <p className="mt-1 text-muted">
          Os títulos que nascem das notas de compra. Abre filtrado pelo que está pendente.
        </p>
      </div>
      <TitlesView clientId={params.id} kind="payable" />
    </div>
  );
}
