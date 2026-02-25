export function requireQueryValue(
  value: string | null | undefined,
  name: string,
): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
