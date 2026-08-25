"use client";

import AnalyzeView from "@/components/AnalyzeView";

export default function ClientAnalyze({ params }: { params: { id: string } }) {
  return <AnalyzeView lockedClientId={params.id} />;
}
