export function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`"${key}" is required`);
  return value;
}

export function list(args: Record<string, string>, key: string): string[] {
  return required(args, key).split(",").map((part) => part.trim()).filter(Boolean);
}
