/**
 * Turning an uploaded spreadsheet into a plain grid of cells.
 *
 * This is the step that used to live inside the sales screen. It came out to
 * `lib/` because a bank statement, a sales file and a chart of accounts are the
 * same problem up to this point: read Excel or delimited text into rows, and
 * let whoever asked decide what the columns mean.
 *
 * Nothing here knows about invoices, sales or statements on purpose.
 */

import * as XLSX from "xlsx";

/**
 * Delimited text, with quotes respected.
 *
 * A naive `split(",")` is fine until a bank writes `"TESCO STORES, DUBLIN"` —
 * and then the description eats the amount column and the whole file lands one
 * column out of place. Quoted fields, doubled quotes inside them and newlines
 * inside a quoted field are all handled.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, ""); // Excel writes a BOM on CSV export
  const delim = delimiter || guessDelimiter(clean);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];

    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"' && field.trim() === "") { quoted = true; field = ""; continue; }
    if (c === delim) { row.push(field.trim()); field = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    rows.push(row);
  }

  // Trailing blank lines are noise, but a blank line *between* rows can be a
  // section break inside the file and is kept.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

/**
 * The separator is decided over the whole file, not the first line: a preamble
 * line like "Statement of account" has no separator at all, and guessing from
 * it would split the entire file wrong.
 */
function guessDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const outside = sample.replace(/"[^"]*"/g, ""); // don't count separators inside quotes
  const counts = [";", "\t", ",", "|"].map((d) => [d, outside.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Cells of the first sheet, or of `sheetName` when given. */
export function workbookRows(buf: ArrayBuffer, sheetName?: string): unknown[][] {
  // cellDates keeps real dates as Date objects instead of Excel serial numbers,
  // which no date parser would recognise.
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: true }) as unknown[][];
}

export type SheetFormat = "xlsx" | "csv";

/** Reads an uploaded file into rows, whichever of the two shapes it is. */
export async function fileToRows(file: File): Promise<{ rows: unknown[][]; format: SheetFormat }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "xlsx" || ext === "xls") {
    return { rows: workbookRows(await file.arrayBuffer()), format: "xlsx" };
  }
  return { rows: parseDelimited(await file.text()), format: "csv" };
}

/** Sheet names in the file, so a workbook with several tabs can be chosen from. */
export async function sheetNames(file: File): Promise<string[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "xlsx" && ext !== "xls") return [];
  return XLSX.read(await file.arrayBuffer(), { type: "array", bookSheets: true }).SheetNames;
}
