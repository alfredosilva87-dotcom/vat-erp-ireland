"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useSession } from "@/components/PermissionScope";
import { licenseStatus, daysUntil } from "@/lib/license";

/**
 * O aviso de licença: popup a um mês, e o estado de bloqueio depois do fim.
 *
 * Substituiu a faixa discreta, que era fácil de não ver — e um aviso que
 * ninguém vê não avisa. Três comportamentos, e a diferença entre eles é
 * deliberada:
 *
 *   A VENCER (≤30 dias) — popup no meio do ecrã, que se FECHA. Volta uma vez
 *     por dia. Incomoda o suficiente para a pessoa tratar do assunto e pouco
 *     o suficiente para não atrapalhar o trabalho do dia.
 *
 *   VENCIDA — popup também se fecha, e é preciso que se feche: com a licença
 *     vencida o sistema fica em modo LEITURA, e uma janela que não fecha
 *     impediria exatamente o que se decidiu continuar a permitir. O que não
 *     sai é a barra vermelha no topo, permanente, e a recusa de qualquer
 *     gravação (402, no `middleware.ts`).
 *
 *   DESLIGADA — igual à vencida no aspeto, mas a empresa foi desligada por
 *     quem vende; não há chave que o próprio admin possa colar.
 *
 * O popup de "a vencer" é lembrado POR DIA e o de "vencida" por SESSÃO. Quem
 * está a três semanas do fim não precisa de ver o aviso a cada clique; quem
 * já venceu precisa de o rever sempre que volta ao sistema.
 */

const CHAVE_DIA = (dia: string) => `vat-license-popup-${dia}`;
const CHAVE_SESSAO = "vat-license-blocked-seen";

export default function LicenseGate() {
  const { t } = useT();
  const { ready, user, company } = useSession();
  const [fechado, setFechado] = useState(true);

  const estado = company ? licenseStatus(company.license_expires_at, company.active) : "ok";
  const vencida = estado === "expired" || estado === "inactive";
  const aVencer = estado === "expiring";
  const admin = user?.role === "admin" || user?.role === "master";

  useEffect(() => {
    if (!ready || !company) return;
    // O master não é travado e renova a licença de outros: avisá-lo da própria
    // a cada dia seria ruído numa tela que não é sobre isso.
    if (user?.role === "master") return;

    try {
      if (vencida) {
        setFechado(sessionStorage.getItem(CHAVE_SESSAO) === "1");
      } else if (aVencer) {
        const hoje = new Date().toISOString().slice(0, 10);
        setFechado(localStorage.getItem(CHAVE_DIA(hoje)) === "1");
      } else {
        setFechado(true);
      }
    } catch {
      // Sem armazenamento (janela privada, política do navegador) o aviso
      // aparece sempre. Um aviso a mais é melhor que um a menos.
      setFechado(false);
    }
  }, [ready, company, user?.role, vencida, aVencer]);

  function fechar() {
    setFechado(true);
    try {
      if (vencida) sessionStorage.setItem(CHAVE_SESSAO, "1");
      else localStorage.setItem(CHAVE_DIA(new Date().toISOString().slice(0, 10)), "1");
    } catch { /* sem armazenamento: volta a aparecer, e tudo bem */ }
  }

  if (!ready || !company || user?.role === "master") return null;
  if (!vencida && !aVencer) return null;

  const dias = company.license_expires_at ? daysUntil(company.license_expires_at) : 0;

  return (
    <>
      {/* A barra permanente só existe depois do vencimento. */}
      {vencida && (
        <div className="flex flex-wrap items-center justify-center gap-3 bg-danger px-4 py-2 text-center text-sm font-medium text-white">
          <span>
            {estado === "inactive" ? t("license.inactiveBanner") : t("license.blockedBar")}
          </span>
          {admin && estado !== "inactive" && (
            <Link href="/settings#license" className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
              {t("license.activateCta")}
            </Link>
          )}
        </div>
      )}

      {!fechado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="card w-full max-w-md p-6">
            <div className={`chip ${vencida ? "chip-danger" : "chip-warn"} mb-3`}>
              {vencida ? t("license.stateExpired") : t("license.stateExpiring")}
            </div>
            <h2 className="font-display text-xl font-semibold">
              {vencida ? t("license.blockedTitle") : t("license.expiringTitle", { days: dias })}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {estado === "inactive"
                ? t("license.inactiveBanner")
                : vencida
                  ? t("license.blockedBody")
                  : t("license.expiringBody", {
                      days: dias, date: company.license_expires_at ?? "",
                    })}
            </p>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button className="btn-ghost h-9 px-4 text-sm" onClick={fechar}>
                {t("license.dismiss")}
              </button>
              {admin && estado !== "inactive" && (
                <Link href="/settings#license" className="btn-primary h-9 px-4 text-sm" onClick={fechar}>
                  {t("license.activateCta")}
                </Link>
              )}
            </div>

            {!admin && (
              <p className="mt-3 text-xs text-muted">{t("license.askAdmin")}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
