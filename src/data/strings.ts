import stringsJson from "../../data/strings.json";

export const STRINGS = stringsJson as Record<string, string>;

/** `{{name}}` inserts a value; `{{name|one|many}}` inserts `one` when the value is 1, else `many`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = STRINGS[key];
  if (template === undefined) throw new Error(`Unknown string key: ${key}`);
  if (!vars) return template;
  return template.replace(/\{\{(\w+)(?:\|([^|}]*)\|([^|}]*))?\}\}/g, (_match, name: string, one?: string, many?: string) => {
    if (one === undefined) return String(vars[name] ?? "");
    return Number(vars[name]) === 1 ? one : many!;
  });
}
