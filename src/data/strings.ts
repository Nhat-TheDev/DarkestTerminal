import stringsJson from "../../data/strings.json";

export const STRINGS = stringsJson as Record<string, string>;

/** Renders a `data/strings.json` template, substituting every `{{key}}` placeholder from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = STRINGS[key];
  if (template === undefined) throw new Error(`Unknown string key: ${key}`);
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ""));
}
