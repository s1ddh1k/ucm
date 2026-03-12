import { ENV_EXACT, ENV_PREFIXES } from "./constants.ts";

export function filterEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  const exactSet = new Set<string>(ENV_EXACT);

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (exactSet.has(key) || ENV_PREFIXES.some((p) => key.startsWith(p))) {
      result[key] = value;
    }
  }
  return result;
}
