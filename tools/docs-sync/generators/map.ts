import { capitalize, formatNumber } from "../format";
import { resolvePath } from "../paths";
import { required } from "./args";
import type { GeneratorSpec } from "../types";

/** Any map of numbers in the balance config as a two-column table: key, value. */
export const map: GeneratorSpec = {
  source: "`data/balance-config.json`",
  args: ["path", "keyHeader", "valueHeader"],
  generate: ({ balance }, args) => {
    const path = required(args, "path");
    const keyHeader = required(args, "keyHeader");
    const valueHeader = required(args, "valueHeader");
    const resolved = resolvePath(balance, path);
    if (!resolved.found) throw new Error(`${path} does not exist in data/balance-config.json`);
    const { value } = resolved;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} is not a map`);
    const rows = Object.entries(value).map(([key, cell]) => {
      if (typeof cell !== "number") throw new Error(`${path}.${key} is not a number`);
      return [capitalize(key), formatNumber(cell)];
    });
    return { columns: [keyHeader, valueHeader], rows };
  },
};
