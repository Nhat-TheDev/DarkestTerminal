declare const __DEV__: boolean;

/**
 * True everywhere except a release binary. `npm run build` compiles with `--define __DEV__=false`,
 * which bun's bundler substitutes for every reference to `__DEV__` at compile time — the resulting
 * executable has no runtime path back to `true`. Any other way of running the game (`bun run`,
 * `bun test`, `bun --watch`) never defines `__DEV__`, so `typeof __DEV__` is `"undefined"` and this
 * stays `true`.
 */
export const DEV_MODE: boolean = typeof __DEV__ !== "undefined" ? __DEV__ : true;
