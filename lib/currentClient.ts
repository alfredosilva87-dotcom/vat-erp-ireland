export type CurrentClient = { id: string; name: string; activity_code: string } | null;
const KEY = "vat.currentClient";

export function getCurrentClient(): CurrentClient {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function setCurrentClient(c: CurrentClient) {
  if (typeof window === "undefined") return;
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("current-client-changed"));
}
