"use client";

import Link from "next/link";
import { useEffect } from "react";

// Safety net for the whole app: any unhandled client-side exception used to
// take the page down to Next's bare "Application error" screen, with no way
// back. This gives a real message and a way out instead.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex flex-wrap min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted">
          An unexpected error happened. You can try again, or head back to sign in.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button className="btn-primary" onClick={reset}>Try again</button>
          <Link href="/login" className="btn-ghost">Go to sign in</Link>
        </div>
      </div>
    </div>
  );
}
