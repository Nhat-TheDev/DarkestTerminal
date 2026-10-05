const SEGMENT = /(\w+)|\[(\d+)\]/g;

export type Resolved = { found: true; value: unknown } | { found: false };

/** Follows `a.b[0].c` through parsed JSON. `found` is false as soon as a segment is missing. */
export function resolvePath(root: unknown, path: string): Resolved {
  let current: unknown = root;
  for (const segment of path.matchAll(SEGMENT)) {
    if (segment[1] !== undefined) {
      const isObject = typeof current === "object" && current !== null && !Array.isArray(current);
      if (!isObject || !Object.hasOwn(current as object, segment[1])) return { found: false };
      current = (current as Record<string, unknown>)[segment[1]];
    } else {
      const index = Number(segment[2]);
      if (!Array.isArray(current) || index >= current.length) return { found: false };
      current = current[index];
    }
  }
  return { found: true, value: current };
}
