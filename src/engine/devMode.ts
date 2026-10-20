declare const __DEV__: boolean;

/** Only the release build defines `__DEV__` (false, substituted at compile time); everything else leaves it undefined. */
export const DEV_MODE: boolean = typeof __DEV__ !== "undefined" ? __DEV__ : true;
