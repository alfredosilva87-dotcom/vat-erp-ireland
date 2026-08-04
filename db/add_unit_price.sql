-- The extractor already reads a per-line unit_price from the document
-- (lib/extractor/prompt.ts), but it was being discarded after extraction —
-- never persisted, never used as a fallback when net_amount itself isn't
-- printed on the document (e.g. TEMU order confirmations, which list
-- quantity + unit price but no explicit line "net" figure). That silently
-- zeroed out credit on those invoices even with take_credit on, since
-- lineVat() in lib/vat.ts has nothing to compute from.
alter table invoice_items add column if not exists unit_price numeric;
