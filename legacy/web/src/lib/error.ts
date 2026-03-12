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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function getHttpStatusCode(error: unknown): number | null {
  const directStatus = asRecord(error)?.status;
  if (typeof directStatus === "number") {
    return directStatus;
  }

  const responseStatus = asRecord(asRecord(error)?.response)?.status;
  return typeof responseStatus === "number" ? responseStatus : null;
}
