"use client";
import { useEffect, useState } from "react";

// Long invoice lists (Database, Purchases) used to dump the reader back at
// the top after "Open" → back, so a note near the bottom of a 100+ row list
// meant scrolling to find it again every time.
const KEY = "lastOpenedRow";

export function rememberOpenedRow(id: string) {
  sessionStorage.setItem(KEY, id);
}

/**
 * Once `ids` (the currently loaded rows) contains the row remembered via
 * rememberOpenedRow, scrolls it into view and returns its id for a moment so
 * the caller can apply a highlight. Row elements must carry `id={rowId(id)}`.
 */
export function useScrollToRow(ids: string[], rowId: (id: string) => string = (id) => `row-${id}`) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // `ids` is normally a fresh array literal on every render (e.g.
  // `invoices.map(i => i.id)`), which would re-fire this effect on every
  // unrelated re-render if we depended on the array reference itself.
  // Depending on the joined content instead means it only fires when the
  // actual set of loaded rows changes.
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    const id = sessionStorage.getItem(KEY);
    if (!id || !ids.includes(id)) return;
    sessionStorage.removeItem(KEY);
    // "auto" (effectively instant) — this fires on page load/return, not on
    // a user click, so snapping into place reads as restoring where you
    // were rather than an animated jump.
    document.getElementById(rowId(id))?.scrollIntoView({ behavior: "auto", block: "center" });
    setHighlightId(id);
    const t = setTimeout(() => setHighlightId(null), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return highlightId;
}
