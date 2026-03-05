/**
 * LLM 출력에서 JSON 추출.
 * 시도 순서: 마크다운 코드블록 → 직접 파싱 → 괄호 위치 탐색
 */
export function extractJson<T = unknown>(raw: string): T | null {
  return fromCodeBlock<T>(raw) ?? fromDirect<T>(raw) ?? fromBrackets<T>(raw);
}

function fromCodeBlock<T>(raw: string): T | null {
  const re = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const parsed = tryParse<T>(match[1].trim());
    if (parsed !== null) return parsed;
  }
  return null;
}

function fromDirect<T>(raw: string): T | null {
  return tryParse<T>(raw.trim());
}

function fromBrackets<T>(raw: string): T | null {
  for (const open of ["{", "["]) {
    const close = open === "{" ? "}" : "]";
    const start = raw.indexOf(open);
    if (start === -1) continue;

    let depth = 0;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === open) depth++;
      else if (raw[i] === close) depth--;
      if (depth === 0) {
        const parsed = tryParse<T>(raw.slice(start, i + 1));
        if (parsed !== null) return parsed;
        break;
      }
    }
  }
  return null;
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
