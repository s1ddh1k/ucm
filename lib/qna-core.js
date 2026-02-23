const EXPECTED_GREENFIELD = { "제품 정의": 4, "핵심 기능": 2, "기술 스택": 1, "설계 결정": 2 };
const EXPECTED_BROWNFIELD = { "작업 목표": 2, "변경 범위": 2, "설계 결정": 2 };

const NON_INFORMATIVE_SIGNAL_RE = [
  /^$/,
  /^n\/a$/,
  /^na$/,
  /^none$/,
  /^unknown$/,
  /^tbd$/,
  /^todo$/,
  /^미정$/,
  /^모름$/,
  /^추후 결정$/,
  /^확인 필요$/,
  /^yes[.!]?$/,
  /^ok(?:ay)?[.!]?$/,
  /^sure[.!]?$/,
  /^네[.!]?$/,
  /^예[.!]?$/,
  /^응[.!]?$/,
  /^맞아요[.!]?$/,
  /^동의$/,
  /^상관없(?:음|어요?)[.!]?$/,
  /^아무거나$/,
  /^\[needs clarification[:\]]/,
];

const GENERIC_NON_ACTIONABLE_SIGNAL_RE = [
  /^기능(?:\s*(?:구현|추가|개선|보완|강화|고도화))?[.!]?$/,
  /^성능(?:\s*(?:개선|향상|최적화))?[.!]?$/,
  /^버그(?:\s*수정)?[.!]?$/,
  /^리팩터링[.!]?$/,
  /^자동화[.!]?$/,
  /^최적화[.!]?$/,
  /^최신\s*기술[.!]?$/,
  /^유연(?:하게)?[.!]?$/,
  /^상황에\s*따라[.!]?$/,
  /^improve(?:ment)?[.!]?$/,
  /^enhance(?:ment)?[.!]?$/,
  /^optimi[sz](?:e|ation)[.!]?$/,
  /^refactor(?:ing)?[.!]?$/,
  /^bug\s*fix(?:es)?[.!]?$/,
];

const PARTIAL_UNRESOLVED_SIGNAL_RE = [
  /\b(?:tbd|todo|unknown)\b/,
  /\b(?:not\s+sure|unsure|i\s+don't\s+know|i\s+do\s+not\s+know)\b/,
  /\[needs clarification[:\]]/,
  /(?:미정|모름|추후 결정|확인 필요|모르겠|알\s*수\s*없|나중에\s*정)/,
];

function normalizeCoverageSignal(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const QUESTION_SIGNAL_STOPWORDS = new Set([
  "무엇", "뭐", "어떤", "어떻게", "왜", "언제", "어디",
  "what", "which", "how", "why", "when", "where",
  "is", "are", "do", "does", "did", "can", "could", "should", "would", "will",
  "please", "kindly",
]);

function normalizeQuestionSignal(value) {
  const signal = normalizeCoverageSignal(value);
  if (!signal) return "";

  const compact = signal
    .replace(/[^0-9a-zA-Z가-힣\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) return signal;

  const tokens = compact
    .split(" ")
    .map((token) => token.replace(/(?:인가요|인가|입니까|일까요|할까요|나요|까요|요)$/g, ""))
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !QUESTION_SIGNAL_STOPWORDS.has(token));

  if (tokens.length === 0) return compact;
  return tokens.join(" ");
}

function isInformativeCoverageSignal(signal) {
  if (typeof signal !== "string") return false;
  if (NON_INFORMATIVE_SIGNAL_RE.some((re) => re.test(signal))) return false;
  if (PARTIAL_UNRESOLVED_SIGNAL_RE.some((re) => re.test(signal))) return false;
  if (GENERIC_NON_ACTIONABLE_SIGNAL_RE.some((re) => re.test(signal))) return false;
  return true;
}

function computeCoverage(decisions, expectedOrBrownfield) {
  const expected = typeof expectedOrBrownfield === "object"
    ? expectedOrBrownfield
    : expectedOrBrownfield ? EXPECTED_BROWNFIELD : EXPECTED_GREENFIELD;
  const coverage = {};
  for (const [area, count] of Object.entries(expected)) {
    const seenAnswerSignals = new Set();
    const seenQuestionSignals = new Set();
    for (const d of decisions) {
      if (d.area !== area) continue;
      const signal = normalizeCoverageSignal(d.requirement || d.answer);
      if (!isInformativeCoverageSignal(signal)) continue;
      seenAnswerSignals.add(signal);

      const questionSignal = normalizeQuestionSignal(d.question);
      seenQuestionSignals.add(questionSignal || signal);
    }
    const answered = Math.min(seenAnswerSignals.size, seenQuestionSignals.size);
    coverage[area] = Math.min(1.0, answered / count);
  }
  return coverage;
}

function isFullyCovered(coverage) {
  return Object.values(coverage).every((v) => v >= 1.0);
}

function hasNonEmptyFeedback(feedback) {
  return typeof feedback === "string" && feedback.trim().length > 0;
}

function collectUnresolvedContradictions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return [];
  const answersByQuestion = new Map();

  for (const d of decisions) {
    const areaSignal = normalizeCoverageSignal(d && d.area);
    const questionSignal = normalizeQuestionSignal(d && d.question);
    if (!areaSignal || !questionSignal) continue;

    const answerSignal = normalizeCoverageSignal((d && (d.requirement || d.answer)) || "");
    if (!isInformativeCoverageSignal(answerSignal)) continue;

    const key = `${areaSignal}\u0000${questionSignal}`;
    if (!answersByQuestion.has(key)) {
      const area = String((d && d.area) || "").trim();
      const question = String((d && d.question) || "").trim();
      answersByQuestion.set(key, {
        area: area || "미지정 영역",
        question: question || "미지정 질문",
        answers: new Map(),
        answerCounts: new Map(),
        lastAnswerSignal: "",
      });
    }

    const entry = answersByQuestion.get(key);
    const answer = String((d && (d.requirement || d.answer)) || "").trim();
    if (!entry.answers.has(answerSignal)) {
      entry.answers.set(answerSignal, answer || answerSignal);
    }
    entry.answerCounts.set(answerSignal, (entry.answerCounts.get(answerSignal) || 0) + 1);
    entry.lastAnswerSignal = answerSignal;
  }

  const contradictions = [];
  for (const entry of answersByQuestion.values()) {
    if (entry.answers.size <= 1) continue;
    const latestCount = entry.answerCounts.get(entry.lastAnswerSignal) || 0;
    if (latestCount > 1) continue;
    contradictions.push({
      area: entry.area,
      question: entry.question,
      answers: Array.from(entry.answers.values()),
    });
  }

  return contradictions;
}

function hasUnresolvedContradictions(decisions) {
  return collectUnresolvedContradictions(decisions).length > 0;
}

function shouldSkipDuplicateQuestion(decisions, candidate) {
  if (!Array.isArray(decisions) || decisions.length === 0) return false;

  const areaSignal = normalizeCoverageSignal(candidate && candidate.area);
  const questionSignal = normalizeQuestionSignal(candidate && candidate.question);
  if (!areaSignal || !questionSignal) return false;

  let alreadyAsked = false;
  let hasInformativeAnswer = false;
  for (const decision of decisions) {
    if (normalizeCoverageSignal(decision && decision.area) !== areaSignal) continue;
    if (normalizeQuestionSignal(decision && decision.question) !== questionSignal) continue;
    alreadyAsked = true;
    const answerSignal = normalizeCoverageSignal(decision && (decision.requirement || decision.answer));
    if (isInformativeCoverageSignal(answerSignal)) hasInformativeAnswer = true;
  }
  if (!alreadyAsked) return false;
  if (!hasInformativeAnswer) return false;

  const contradictions = collectUnresolvedContradictions(decisions);
  const requiresResolution = contradictions.some((conflict) => (
    normalizeCoverageSignal(conflict && conflict.area) === areaSignal
    && normalizeQuestionSignal(conflict && conflict.question) === questionSignal
  ));

  return !requiresResolution;
}

function shouldStopQnaForCoverage(coverage, feedback, decisions = []) {
  if (!isFullyCovered(coverage)) return false;
  if (hasUnresolvedContradictions(decisions)) return false;
  return !hasNonEmptyFeedback(feedback);
}

function estimateRequiredFollowupsFromFeedback(feedback) {
  if (!hasNonEmptyFeedback(feedback)) return 0;
  const text = String(feedback);
  const isStructuredGapReport = /(?:^|\n)#\s*Gap Report\b/i.test(text)
    || /검증 결과 아래 항목이 부족합니다\./.test(text);
  if (!isStructuredGapReport) return 1;

  const gaps = text.match(/^\s*-\s+\*\*[^*\n]+\*\*:/gm);
  if (!gaps || gaps.length === 0) return 1;
  return gaps.length;
}

function parseStructuredFeedbackGaps(feedback) {
  if (!hasNonEmptyFeedback(feedback)) return [];
  const text = String(feedback);
  const isStructuredGapReport = /(?:^|\n)#\s*Gap Report\b/i.test(text)
    || /검증 결과 아래 항목이 부족합니다\./.test(text);
  if (!isStructuredGapReport) return [];

  const gaps = [];
  const gapRe = /^\s*-\s+\*\*([^*\n]+)\*\*:\s*(.+)$/gm;
  let match = gapRe.exec(text);
  while (match) {
    gaps.push({ criterion: match[1].trim(), detail: match[2].trim() });
    match = gapRe.exec(text);
  }
  return gaps;
}

const GAP_KEYWORD_STOPWORDS = new Set([
  "및", "또는", "아래", "항목", "관련", "대해", "대한", "같은",
  "부족", "필요", "추가", "강화", "보강", "개선", "정의", "명시",
  "구체", "구체적", "구체적으로", "명확", "명확히", "수준",
  "검증", "결과", "기준", "조건",
  "the", "and", "for", "with", "from", "that", "this",
]);

function extractGapKeywords(gap) {
  const raw = `${gap?.criterion || ""} ${gap?.detail || ""}`;
  const tokens = normalizeCoverageSignal(raw)
    .split(/[^0-9a-zA-Z가-힣]+/)
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !GAP_KEYWORD_STOPWORDS.has(token));

  return Array.from(new Set(tokens));
}

function buildMeaningfulDecisionSignal(decision) {
  const areaSignal = normalizeCoverageSignal(decision && decision.area);
  const questionSignal = normalizeQuestionSignal(decision && decision.question);
  const answerSignal = normalizeCoverageSignal(decision && (decision.requirement || decision.answer));

  if (!questionSignal) return null;
  if (!isInformativeCoverageSignal(answerSignal)) return null;

  return `${areaSignal}\u0000${questionSignal}\u0000${answerSignal}`;
}

function collectMeaningfulFollowups(decisions, feedbackStartDecisionsCount) {
  if (!Array.isArray(decisions)) return null;
  if (typeof feedbackStartDecisionsCount !== "number") return null;

  const start = Math.max(0, feedbackStartDecisionsCount);
  if (decisions.length < start) return null;

  const seen = new Set();
  const followups = [];

  for (let i = 0; i < start; i++) {
    const key = buildMeaningfulDecisionSignal(decisions[i]);
    if (!key) continue;
    seen.add(key);
  }

  for (let i = start; i < decisions.length; i++) {
    const key = buildMeaningfulDecisionSignal(decisions[i]);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    followups.push(decisions[i]);
  }

  return followups;
}

function followupAddressesGap(decision, gapKeywords) {
  if (!Array.isArray(gapKeywords) || gapKeywords.length === 0) return true;
  const uniqueKeywords = Array.from(new Set(gapKeywords.filter(Boolean)));
  if (uniqueKeywords.length === 0) return true;

  const decisionText = normalizeCoverageSignal([
    decision && decision.area,
    decision && decision.question,
    decision && (decision.requirement || decision.answer),
    decision && decision.reason,
  ].filter(Boolean).join(" "));
  if (!decisionText) return false;

  let matched = 0;
  for (const keyword of uniqueKeywords) {
    if (decisionText.includes(keyword)) matched++;
  }
  const minimumMatches = uniqueKeywords.length >= 2 ? 2 : 1;
  return matched >= minimumMatches;
}

function areStructuredGapsAddressed(feedback, meaningfulFollowups) {
  const gaps = parseStructuredFeedbackGaps(feedback);
  if (gaps.length === 0) return true;
  if (!Array.isArray(meaningfulFollowups) || meaningfulFollowups.length === 0) return true;

  return gaps.every((gap) => {
    const keywords = extractGapKeywords(gap);
    return meaningfulFollowups.some((decision) => followupAddressesGap(decision, keywords));
  });
}

function shouldAcceptDoneResponse({ coverage, feedback, decisionsCount, feedbackStartDecisionsCount, decisions = [] }) {
  if (!isFullyCovered(coverage)) return false;
  if (hasUnresolvedContradictions(decisions)) return false;
  if (!hasNonEmptyFeedback(feedback)) return true;
  if (typeof decisionsCount !== "number" || typeof feedbackStartDecisionsCount !== "number") return false;
  const requiredFollowups = estimateRequiredFollowupsFromFeedback(feedback);
  const followupsByCount = Math.max(0, decisionsCount - feedbackStartDecisionsCount);
  const meaningfulFollowups = collectMeaningfulFollowups(decisions, feedbackStartDecisionsCount);
  const followupsCollected = Array.isArray(meaningfulFollowups) ? meaningfulFollowups.length : followupsByCount;
  if (followupsCollected < requiredFollowups) return false;
  return areStructuredGapsAddressed(feedback, meaningfulFollowups);
}

function buildQuestionPrompt(template, decisions, feedback, { isResume, isBrownfield, coverage, repoContext }) {
  const expected = isBrownfield ? EXPECTED_BROWNFIELD : EXPECTED_GREENFIELD;
  const areas = Object.keys(expected);
  const contradictions = collectUnresolvedContradictions(decisions);

  let prompt = `당신은 소프트웨어 설계 의사결정을 돕는 인터뷰어입니다.
사용자에게 객관식 질문을 하나씩 제시하여 핵심 설계 결정을 수집합니다.

## 규칙

1. 한 번에 질문 하나만 합니다.
2. 각 질문에 3-4개 선택지를 제공합니다. 각 선택지에 이유를 포함합니다.
3. 이미 수집된 결정을 반드시 확인하고, 같은 내용이나 이미 답변에서 언급된 내용을 다시 묻지 마세요.
4. 사용자의 이전 답변에 포함된 정보(도구명, 방식, 제약사항 등)를 기억하고 활용하세요.
5. "직접 입력하겠습니다" 같은 메타 선택지를 만들지 마세요. 사용자는 항상 번호 대신 자유 텍스트를 입력할 수 있습니다.
6. 규모가 "프로토타입" 또는 "개인 프로젝트"이면 설계 결정 영역은 최대 2-3개 질문으로 끝냅니다.
7. 아래 현재 커버리지를 보고, 부족한 영역을 우선 질문하세요.
8. 모든 영역이 충분히 커버되었다고 판단하면 done: true로 응답합니다.
9. 이전 답변과 모순되는 답변이 들어오면 새 주제로 넘어가지 말고 모순되는 답변을 짚어 어느 쪽이 맞는지 확인하는 질문을 먼저 하세요.

## 고정 영역

${areas.map((a) => `- ${a} (기대 질문 수: ${expected[a]})`).join("\n")}

이 영역 이름만 사용하세요. 다른 이름을 만들지 마세요.

## 현재 커버리지

${Object.entries(coverage).map(([a, v]) => `- ${a}: ${Math.round(v * 100)}%`).join("\n")}

## 응답 형식 (JSON만 출력)

{
  "question": "질문 텍스트",
  "options": [
    { "label": "선택지 텍스트", "reason": "이 선택이 적합한 이유" }
  ],
  "area": "위 고정 영역 중 하나",
  "done": false
}

모든 영역이 충분히 커버되었으면:
{ "done": true }`;

  if (isBrownfield) {
    prompt += `\n\n## 브라운필드 모드

이 프로젝트는 기존 코드베이스가 있습니다.
`;

    if (repoContext) {
      prompt += `
### 스캔 요약 (이미 수행됨)

아래 요약을 참고하여 질문을 생성하세요.
**추가 스캔/파일 읽기를 하지 마세요.**

${repoContext}
`;
    } else {
      prompt += `
### 코드 스캔 (필수)

질문을 생성하기 전에 반드시:
1. Glob 도구로 프로젝트의 파일 구조를 확인하세요.
2. Read 도구로 핵심 파일(README, package.json, 주요 소스 등)을 읽으세요.
3. 기존 기술 스택, 아키텍처, 패턴을 파악하세요.
`;
    }

    prompt += `
### 질문 흐름 (엄수)

1. **Q1 — 작업 대상 (작업 목표)**: 코드 스캔에서 발견한 모듈/파일을 선택지로 나열.
   예: "어떤 모듈을 작업하시나요?" → 선택지: "prl.js (병렬 실행)", "rsa.js (파이프라인)", ...
2. **Q2 — 작업 유형 (작업 목표)**: 선택된 모듈에 대해 구체적으로 무엇을 할 건지.
   예: "prl.js에서 어떤 작업을 하시나요?" → 선택지: "에러 처리 개선", "새 옵션 추가", ...
3. **Q3~ — 변경 범위**: 해당 모듈의 어떤 부분을, 얼마나 바꿀 건지.
   선택지에 실제 함수명, 패턴명 등 코드에서 읽은 구체적 정보를 포함하세요.
4. **설계 결정**: 변경 범위가 확정된 후, 구현 방식에 대한 질문.

### 금지사항

- "무엇을 만드는가"를 묻지 마세요. 코드를 읽으면 알 수 있습니다.
- 기술 스택은 코드에서 읽은 것을 사실로 취급하고 묻지 마세요.
- 추상적 선택지 금지. 선택지에 반드시 코드에서 발견한 구체적 이름(파일, 함수, 패턴)을 포함하세요.
- 작업 목표 영역에 3개 이상 질문 금지. 목표 확인은 1-2개 질문으로 끝내세요.`;
  }

  if (template) {
    prompt += `\n\n## 설계 템플릿\n\n${template}`;
  } else {
    prompt += `\n\n## 템플릿 없음\n\n일반적인 소프트웨어 설계 영역에 대해 질문하세요.`;
  }

  if (decisions.length > 0) {
    prompt += `\n\n## 지금까지 수집된 결정 (절대 같은 내용을 다시 묻지 마세요)\n\n`;
    for (const d of decisions) {
      prompt += `- **[${d.area}]** ${d.question} → ${d.answer}\n`;
    }
  }

  if (contradictions.length > 0) {
    prompt += `\n\n## 감지된 모순 후보 (최우선으로 해소)\n\n`;
    for (const conflict of contradictions.slice(0, 5)) {
      const answers = conflict.answers.slice(0, 4).join(" / ");
      prompt += `- **[${conflict.area}]** ${conflict.question}\n`;
      prompt += `  - 상충 답변: ${answers}\n`;
    }
    prompt += `\n다음 질문은 반드시 위 모순 중 하나를 해소하는 확인 질문이어야 합니다.`;
  }

  if (feedback) {
    prompt += `\n\n## 추가 컨텍스트\n\n${feedback}`;
  }

  prompt += `\n\n반드시 JSON만 출력하세요.`;
  return prompt;
}

function parseDecisionsFile(content) {
  const decisions = [];
  const lines = content.split("\n");
  let currentArea = "";
  for (const line of lines) {
    const areaMatch = line.match(/^### (.+)/);
    if (areaMatch) {
      currentArea = areaMatch[1];
      continue;
    }
    const decisionMatch = line.match(/^- \*\*Q:\*\* (.+)/);
    if (decisionMatch) {
      decisions.push({ area: currentArea, question: decisionMatch[1], answer: "", reason: "" });
      continue;
    }
    const answerMatch = line.match(/^\s+- \*\*A:\*\* (.+)/);
    if (answerMatch && decisions.length > 0) {
      decisions[decisions.length - 1].answer = answerMatch[1];
      continue;
    }
    const reasonMatch = line.match(/^\s+- \*\*이유:\*\* (.+)/);
    if (reasonMatch && decisions.length > 0) {
      decisions[decisions.length - 1].reason = reasonMatch[1];
    }
  }
  return decisions;
}

function formatDecisions(decisions, coverage) {
  const byArea = {};
  for (const d of decisions) {
    if (!byArea[d.area]) byArea[d.area] = [];
    byArea[d.area].push(d);
  }

  let md = `# 설계 결정\n\n`;

  if (coverage && Object.keys(coverage).length > 0) {
    md += `## 커버리지\n\n`;
    for (const [area, value] of Object.entries(coverage)) {
      const pct = Math.round(value * 100);
      const bar = "█".repeat(Math.round(value * 10)) + "░".repeat(10 - Math.round(value * 10));
      md += `- ${area}: ${bar} ${pct}%\n`;
    }
    md += `\n`;
  }

  md += `## 결정 사항\n\n`;
  for (const [area, items] of Object.entries(byArea)) {
    md += `### ${area}\n\n`;
    for (const d of items) {
      md += `- **Q:** ${d.question}\n`;
      md += `  - **A:** ${d.answer}\n`;
      if (d.reason) {
        md += `  - **이유:** ${d.reason}\n`;
      }
    }
    md += `\n`;
  }

  return md;
}

// ── Refinement 전용 (태스크 파이프라인 — analyze/spec 스테이지가 소비하는 구체적 요구사항 지향) ──

const REFINEMENT_GREENFIELD = {
  "기능 요구사항": 6,
  "수용 조건": 4,
  "기술 제약": 3,
  "범위": 3,
  "에지 케이스": 3,
  "UX/인터페이스": 3,
};

const REFINEMENT_BROWNFIELD = {
  "변경 대상": 3,
  "기능 요구사항": 5,
  "수용 조건": 3,
  "제약": 3,
  "영향 범위": 3,
  "에지 케이스": 3,
};

function buildRefinementPrompt(decisions, taskDescription, { coverage, repoContext, isBrownfield }) {
  const expected = isBrownfield ? REFINEMENT_BROWNFIELD : REFINEMENT_GREENFIELD;
  const areas = Object.keys(expected);

  let prompt = `당신은 태스크 요구사항을 구체화하는 도우미입니다.
사용자의 태스크를 analyze/implement 스테이지가 바로 사용할 수 있는 구체적 요구사항으로 만들기 위해 질문합니다.

## 규칙

1. 한 번에 질문 하나만 합니다.
2. 각 질문에 3-4개 선택지를 제공합니다. 각 선택지에 이유를 포함합니다.
3. 이미 수집된 결정을 반드시 확인하고, 같은 내용이나 이미 답변에서 언급된 내용을 다시 묻지 마세요.
4. 사용자의 이전 답변에 포함된 정보를 기억하고 활용하세요.
5. "직접 입력하겠습니다" 같은 메타 선택지를 만들지 마세요.
6. 아래 현재 커버리지를 보고, 부족한 영역을 우선 질문하세요.
7. 모든 영역이 충분히 커버되었다고 판단하면 done: true로 응답합니다.
8. **이전 답변과 모순되는 답변을 발견하면, 다음 질문 대신 모순을 지적하고 어느 쪽이 맞는지 확인하세요.** 예: "앞서 X라고 답하셨는데, 방금 Y라고 하셨습니다. 어느 쪽이 맞나요?" 형태의 선택지를 제시합니다.
9. 모호하거나 너무 넓은 답변에는 후속 질문으로 구체화를 요청하세요.

## 질문 방향

- "이 기능이 구체적으로 어떻게 동작해야 하는가?" (동작 중심)
- "사용자가 이 기능을 어떻게 사용하는가? 입력은? 출력은?" (UX/인터페이스)
- "완료 판단 기준은 무엇인가? 어떻게 테스트하는가?" (검증 가능한 수용 조건)
- "어떤 기술적/비즈니스 제약이 있는가? 성능 요구는?" (제약)
- "예외적인 상황에서 어떻게 동작해야 하는가? 잘못된 입력은?" (에지 케이스)
- "이 변경이 다른 부분에 어떤 영향을 주는가?" (영향 범위)
- 추상적인 설계 질문("기술 스택은?", "아키텍처 패턴은?") 대신 구체적 동작/기능/조건을 물어보세요.
- 각 질문은 이전 답변을 기반으로 더 깊이 파고들어야 합니다. 표면적인 질문을 반복하지 마세요.
- 하나의 영역 안에서도 다양한 측면을 다루세요. 같은 관점의 질문을 반복하면 안 됩니다.

## 고정 영역

${areas.map((a) => `- ${a} (기대 질문 수: ${expected[a]})`).join("\n")}

이 영역 이름만 사용하세요. 다른 이름을 만들지 마세요.

## 현재 커버리지

${Object.entries(coverage).map(([a, v]) => `- ${a}: ${Math.round(v * 100)}%`).join("\n")}

## 응답 형식 (JSON만 출력)

{
  "question": "질문 텍스트",
  "options": [
    { "label": "선택지 텍스트", "reason": "이 선택이 적합한 이유" }
  ],
  "area": "위 고정 영역 중 하나",
  "done": false
}

모든 영역이 충분히 커버되었으면:
{ "done": true }`;

  if (isBrownfield) {
    prompt += `\n\n## 브라운필드 모드

이 프로젝트는 기존 코드베이스가 있습니다.
`;

    if (repoContext) {
      prompt += `
### 스캔 요약 (이미 수행됨)

아래 요약을 참고하여 질문을 생성하세요.
**추가 스캔/파일 읽기를 하지 마세요.**

${repoContext}
`;
    }

    prompt += `
### 질문 지침

- 코드에서 발견한 실제 파일/함수명을 선택지에 포함하세요.
- "변경 대상" 영역: 어떤 모듈/파일을 변경하는지, 변경 방식은 무엇인지 구체적으로 확인.
- "기능 요구사항" 영역: 변경할 동작을 구체적으로 확인. 입력/출력/상태 변화를 명확히.
- "영향 범위" 영역: 변경이 의존하는 모듈, 호출하는 쪽, 테스트에 미치는 영향을 확인.
- 기술 스택은 코드에서 읽은 것을 사실로 취급하고 묻지 마세요.`;
  }

  if (decisions.length > 0) {
    prompt += `\n\n## 지금까지 수집된 결정 (절대 같은 내용을 다시 묻지 마세요)\n\n`;
    for (const d of decisions) {
      prompt += `- **[${d.area}]** ${d.question} → ${d.answer}\n`;
    }
  }

  if (taskDescription) {
    prompt += `\n\n## 태스크 설명\n\n${taskDescription}`;
  }

  prompt += `\n\n반드시 JSON만 출력하세요.`;
  return prompt;
}

function buildAutopilotRefinementPrompt(session) {
  const expected = session.isBrownfield ? REFINEMENT_BROWNFIELD : REFINEMENT_GREENFIELD;
  const areas = Object.keys(expected);
  const coverage = computeCoverage(session.decisions, expected);

  let prompt = `당신은 태스크 요구사항을 자동으로 구체화하는 AI입니다.
주어진 태스크에 대해 질문을 생성하고 스스로 답변하여 구체적 요구사항을 도출합니다.

## 태스크
- 제목: ${session.title}
- 설명: ${session.description || "(없음)"}

## 규칙
1. 한 번에 질문 하나와 답변 하나를 생성합니다.
2. 이미 수집된 결정을 확인하고, 같은 내용을 다시 다루지 마세요.
3. 아래 커버리지를 보고 부족한 영역을 우선 처리하세요.
4. 모든 영역이 충분히 커버되면 done: true로 응답합니다.

## 질문 방향

- "이 기능이 구체적으로 어떻게 동작해야 하는가?" (동작 중심)
- "사용자가 이 기능을 어떻게 사용하는가? 입력은? 출력은?" (UX/인터페이스)
- "완료 판단 기준은 무엇인가? 어떻게 테스트하는가?" (수용 조건)
- "예외 상황에서 어떻게 동작해야 하는가? 잘못된 입력은?" (에지 케이스)
- "이 변경이 다른 부분에 어떤 영향을 주는가?" (영향 범위)
- 추상적 설계 질문 대신 구체적 동작/기능/조건을 다루세요.
- 이전 답변을 기반으로 더 깊이 파고드세요. 표면적 질문을 반복하지 마세요.
- 하나의 영역 안에서도 다양한 측면을 다루세요.
- requirement 필드에 이 Q&A에서 도출된 한 줄 요구사항을 작성하세요.

## 고정 영역
${areas.map((a) => `- ${a} (기대 질문 수: ${expected[a]})`).join("\n")}

## 현재 커버리지
${Object.entries(coverage).map(([a, v]) => `- ${a}: ${Math.round(v * 100)}%`).join("\n")}`;

  if (session.repoContext) {
    prompt += `\n\n## 코드베이스 컨텍스트\n\n${session.repoContext}`;
  } else {
    prompt += `\n\n## 컨텍스트 없음\n\n프로젝트 경로가 없습니다. 일반 소프트웨어 설계 원칙에 기반하여 답변하세요.`;
  }

  if (session.decisions.length > 0) {
    prompt += `\n\n## 지금까지 수집된 결정\n\n`;
    for (const d of session.decisions) {
      prompt += `- **[${d.area}]** ${d.question} → ${d.answer}\n`;
    }
  }

  prompt += `\n\n## 응답 형식 (JSON만 출력)

{
  "question": "질문 텍스트",
  "area": "위 고정 영역 중 하나",
  "answer": "답변 텍스트",
  "reason": "이 답변을 선택한 이유",
  "requirement": "이 Q&A에서 도출된 한 줄 요구사항",
  "done": false
}

모든 영역이 충분히 커버되었으면:
{ "done": true, "pipeline": "quick|implement|research|thorough 중 하나" }

pipeline 선택 기준:
- quick: 단순 변경, 설정, 문서, 작은 버그 수정
- implement: 일반적인 기능 구현 (테스트+리뷰 루프 포함)
- research: 조사/분석이 주 목적인 태스크
- thorough: 복잡한 기능, 아키텍처 변경, 안전이 중요한 변경

반드시 JSON만 출력하세요.`;

  return prompt;
}

function formatRefinedRequirements(decisions) {
  const sectionMap = {
    "기능 요구사항": "functionalRequirements",
    "수용 조건": "acceptanceCriteria",
    "기술 제약": "technicalConstraints",
    "제약": "technicalConstraints",
    "범위": "scope",
    "변경 대상": "implementationHints",
    "에지 케이스": "edgeCases",
    "영향 범위": "impactScope",
    "UX/인터페이스": "uxInterface",
  };

  const sections = {
    functionalRequirements: [],
    acceptanceCriteria: [],
    technicalConstraints: [],
    scope: [],
    implementationHints: [],
    edgeCases: [],
    impactScope: [],
    uxInterface: [],
  };

  for (const d of decisions) {
    const requirement = d.requirement || d.answer;
    const section = sectionMap[d.area] || "functionalRequirements";
    if (sections[section]) sections[section].push(requirement);
  }

  const sectionDefs = [
    ["functionalRequirements", "Functional Requirements", true],
    ["acceptanceCriteria", "Acceptance Criteria", false],
    ["technicalConstraints", "Technical Constraints", false],
    ["edgeCases", "Edge Cases", false],
    ["impactScope", "Impact Scope", false],
    ["uxInterface", "UX / Interface", false],
    ["scope", "Scope", false],
    ["implementationHints", "Implementation Hints", false],
  ];

  let md = `## Refined Requirements\n\n`;
  for (const [key, title, numbered] of sectionDefs) {
    if (sections[key].length > 0) {
      md += `### ${title}\n\n`;
      sections[key].forEach((r, i) => { md += numbered ? `${i + 1}. ${r}\n` : `- ${r}\n`; });
      md += `\n`;
    }
  }

  return md;
}

module.exports = {
  EXPECTED_GREENFIELD, EXPECTED_BROWNFIELD,
  REFINEMENT_GREENFIELD, REFINEMENT_BROWNFIELD,
  computeCoverage, isFullyCovered, hasUnresolvedContradictions, shouldSkipDuplicateQuestion,
  shouldStopQnaForCoverage, shouldAcceptDoneResponse,
  buildQuestionPrompt, formatDecisions, parseDecisionsFile,
  buildRefinementPrompt, buildAutopilotRefinementPrompt, formatRefinedRequirements,
};
