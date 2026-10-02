/** A required marker argument, or an error that names it. */
export function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`"${key}" is required`);
  return value;
}

/** A comma-separated argument such as `ids=a,b,c`, in the order written. */
export function list(args: Record<string, string>, key: string): string[] {
  return required(args, key).split(",").map((part) => part.trim()).filter(Boolean);
}
