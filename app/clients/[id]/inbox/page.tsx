"use client";

import InboxView from "@/components/InboxView";

export default function ClientInbox({ params }: { params: { id: string } }) {
  return <InboxView lockedClientId={params.id} />;
}
