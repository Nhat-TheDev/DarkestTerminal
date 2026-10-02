import type { Finding } from "./types";

/** `docs/<path>.md`. */
const FULL_PATH = /(?<![\w.\/-])docs\/[\w.\/-]+\.md/g;
/** `NN-name.md`, the naming of the gameplay-decisions files, written without a directory. */
const NUMBERED_NAME = /(?<![\w.\/-])\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md/g;

export interface RefSource {
  /** Repo-relative path of the file being scanned. */
  file: string;
  text: string;
}

export interface RefTargets {
  /** True when the repo-relative path exists on disk. */
  exists(path: string): boolean;
  /** The names of the files under `docs/`, without their directory. */
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
