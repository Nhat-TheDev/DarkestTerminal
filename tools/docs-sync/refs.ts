import type { Finding } from "./types";

const FULL_PATH = /(?<![\w.\/-])docs\/[\w.\/-]+\.md/g;
/** A gameplay-decisions file named without its directory. */
const NUMBERED_NAME = /(?<![\w.\/-])\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md/g;

export interface RefSource {
  file: string;
  text: string;
}

export interface RefTargets {
  exists(path: string): boolean;
  docNames: ReadonlySet<string>;
}

export function checkReferences(sources: readonly RefSource[], targets: RefTargets): Finding[] {
  const findings: Finding[] = [];
  for (const { file, text } of sources) {
    text.split("\n").forEach((line, index) => {
      const report = (name: string) =>
        findings.push({ file, line: index + 1, message: `names ${name}, which does not exist`, fixable: false });
      for (const [path] of line.matchAll(FULL_PATH)) if (!targets.exists(path)) report(path);
      for (const [name] of line.matchAll(NUMBERED_NAME)) if (!targets.docNames.has(name)) report(name);
    });
  }
  return findings;
}
