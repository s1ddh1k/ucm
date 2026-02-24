export function getErrorDetail(
  error: unknown,
  fallback = "unknown error",
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

export function buildActionErrorMessage(
  action: string,
  error: unknown,
  nextStep: string,
): string {
  return `${action}: ${getErrorDetail(error)}. ${nextStep}`;
}
