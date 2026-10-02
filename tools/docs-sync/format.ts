/** A gap this small from a whole number is floating-point noise, not a real fraction. */
const INTEGER_NOISE = 1e-9;
const nearWhole = (value: number) => Math.abs(value - Math.round(value)) < INTEGER_NOISE;

/** A value from the data as it is: a whole number without a decimal, anything else with the noise of a sum or product removed. */
export function formatNumber(value: number): string {
  return nearWhole(value) ? String(Math.round(value)) : String(Number(value.toPrecision(12)));
}

/** A computed value, such as an odds weight, to one decimal place; a whole number prints without one. */
export function formatRounded(value: number): string {
  return nearWhole(value) ? String(Math.round(value)) : value.toFixed(1);
}

/** Any field value as table text: numbers through `formatNumber`, an array with slashes, an object as `key value` pairs. */
export function showValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value);
  if (Array.isArray(value)) return value.map(showValue).join(" / ");
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([key, item]) => `${key} ${typeof item === "object" && item !== null && !Array.isArray(item) ? `(${showValue(item)})` : showValue(item)}`)
      .join(", ");
  }
  return String(value);
}

/** `low–high` with an en dash, or one number when the two ends are the same. */
export function formatRange(low: number, high: number): string {
  return low === high ? formatNumber(low) : `${formatNumber(low)}–${formatNumber(high)}`;
}

/** A rate such as 0.7 as `70%`. */
export function formatPercent(rate: number): string {
  return `${formatNumber(rate * 100)}%`;
}

export const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
