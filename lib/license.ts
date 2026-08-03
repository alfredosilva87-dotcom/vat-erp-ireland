// Single source of truth for the 30-day licence-expiry threshold, shared by
// the master panel (per-company chip) and the LicenseAlertBanner (proactive
// alert for tenant users and master).

export type LicenseState = "inactive" | "none" | "expired" | "expiring" | "ok";

const DAY_MS = 86400000;
const WARN_DAYS = 30;

export function daysUntil(expiresAt: string): number {
  return Math.round((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);
}

export function licenseStatus(
  expiresAt: string | null,
  active: boolean
): LicenseState {
  if (!active) return "inactive";
  if (!expiresAt) return "none";
  const today = new Date().toISOString().slice(0, 10);
  if (expiresAt < today) return "expired";
  if (daysUntil(expiresAt) <= WARN_DAYS) return "expiring";
  return "ok";
}

/** States worth surfacing a proactive banner for. */
export function needsAlert(state: LicenseState): boolean {
  return state === "inactive" || state === "expired" || state === "expiring";
}
