import type { ExportRow } from "./types";

export function serializeDelimited(headers: string[], rows: ExportRow[], delimiter: "," | "\t"): string {
  const escapeCell = (value: string) => {
    const text = neutralizeSpreadsheetFormula(String(value ?? ""));
    if (delimiter === "\t") {
      return text.replace(/\r?\n/g, " ").replace(/\t/g, " ");
    }

    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, "\"\"")}"`;
    }

    return text;
  };

  const lines = [headers.map(escapeCell).join(delimiter)];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCell(row[header] ?? "")).join(delimiter));
  });

  return `${lines.join("\n")}\n`;
}

export function neutralizeSpreadsheetFormula(text: string): string {
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}
