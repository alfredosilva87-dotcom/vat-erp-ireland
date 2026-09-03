"use client";

import RevenueCertificate from "@/components/hr/RevenueCertificate";
import { useT } from "@/lib/i18n";

/**
 * A ligação à Revenue vive no menu GERAL do RH, e não dentro de um cliente.
 *
 * Pela mesma razão que as tabelas fiscais: o certificado é do ESCRITÓRIO e vale
 * para os 35 clientes. Pô-lo dentro de um cliente sugeriria que cada cliente
 * tem o seu — e o que existe é o contrário: um certificado do escritório mais
 * um TAIN de agente, que é como a Revenue sabe quem fala por quem.
 */
export default function RevenuePage() {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{t("rev.title")}</h1>
        <p className="mt-1 text-muted">{t("rev.pageSubtitle")}</p>
      </div>
      <RevenueCertificate />
    </div>
  );
}
