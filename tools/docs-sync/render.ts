import type { DocTable } from "./types";

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
}

export function renderMarkdown(table: DocTable): string {
  const rule = `|${table.columns.map(() => "---").join("|")}|`;
  return [row(table.columns), rule, ...table.rows.map(row)].join("\n");
}
