// Company types (business activities). Each maps to the credit-rule base.
// Codes marked with a dedicated rule set get specific credit suggestions;
// others fall back to the generic "*" rules until refined.

export interface Activity {
  code: string;
  label: string;
}

export const ACTIVITIES: Activity[] = [
  { code: "RESTAURANT", label: "Restaurant / catering" },
  { code: "RETAIL", label: "Retail / shop (resale)" },
  { code: "WHOLESALE", label: "Wholesale / distribution" },
  { code: "HOSPITALITY", label: "Hotel / hospitality" },
  { code: "CONSTRUCTION", label: "Construction / trades" },
  { code: "PROFESSIONAL", label: "Professional services" },
  { code: "TRANSPORT", label: "Transport / logistics" },
  { code: "AGRICULTURE", label: "Agriculture / farming" },
  { code: "HEALTHCARE", label: "Healthcare / medical" },
  { code: "MANUFACTURING", label: "Manufacturing" },
  { code: "GENERIC", label: "Generic business" },
];

export const activityLabel = (code: string | null | undefined) =>
  ACTIVITIES.find((a) => a.code === code)?.label || "Generic business";
