const { slugify } = require("./templates");

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
]);
const ALLOWED_KINDS = new Set(["why", "verification", "notes"]);
const MAX_LIST_ITEMS = 6;
const MAX_QUESTIONS = 4;
const MAX_SUBJECT_LENGTH = 58;
const MAX_BULLET_LENGTH = 140;
const MAX_REF_LENGTH = 120;

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateLine(value, maxLength) {
  const text = cleanLine(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}\u2026`;
}

function uniqueLines(values, limit = MAX_LIST_ITEMS) {
  const seen = new Set();
  const result = [];

  for (const item of Array.isArray(values) ? values : []) {
    const value = truncateLine(item, MAX_BULLET_LENGTH);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
    if (result.length >= limit) break;
  }

  return result;
}

function normalizeType(type, fallbackType) {
  const normalized = String(type || "").trim().toLowerCase();
  return ALLOWED_TYPES.has(normalized) ? normalized : fallbackType;
}

function normalizeSubject(subject, fallbackSubject) {
  let value = cleanLine(subject || fallbackSubject)
    .replace(/^[a-z]+(?:\([^)]+\))?:\s*/i, "")
    .replace(/[.;:!?]+$/, "");
  value = truncateLine(value, MAX_SUBJECT_LENGTH);

  if (/^[A-Z][a-z]/.test(value)) {
    value = `${value[0].toLowerCase()}${value.slice(1)}`;
  }
  return value || cleanLine(fallbackSubject);
}

function normalizeScope(scope, fallbackScope) {
  const normalized = String(scope || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallbackScope;
}

function normalizeQuestion(question, index) {
  const prompt = cleanLine(question?.question);
  if (!prompt) return null;
  const kind = ALLOWED_KINDS.has(question?.kind) ? question.kind : "notes";
  const id = slugify(question?.id || prompt).replace(/-/g, "_") || `question_${index + 1}`;
  return {
    id,
    kind,
    question: prompt,
  };
}

function normalizeQuestions(questions) {
  const seen = new Set();
  const result = [];

  for (const [index, question] of (Array.isArray(questions) ? questions : []).entries()) {
    const normalized = normalizeQuestion(question, index);
    if (!normalized) continue;
    const key = `${normalized.kind}:${normalized.question}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= MAX_QUESTIONS) break;
  }

  return result;
}

function normalizeCommitPlan(raw, fallbackPlan) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalizedRefs = uniqueLines(source.refs, 4).map((ref) =>
    truncateLine(ref, MAX_REF_LENGTH),
  );
  return {
    type: normalizeType(source.type, fallbackPlan.type),
    scope: normalizeScope(source.scope, fallbackPlan.scope),
    subject: normalizeSubject(source.subject, fallbackPlan.subject),
    whyBullets: uniqueLines(source.whyBullets, 3).length
      ? uniqueLines(source.whyBullets, 3)
      : fallbackPlan.whyBullets,
    changeBullets: uniqueLines(source.changeBullets, 4).length
      ? uniqueLines(source.changeBullets, 4)
      : fallbackPlan.changeBullets,
    verificationBullets: uniqueLines(source.verificationBullets, 3).length
      ? uniqueLines(source.verificationBullets, 3)
      : fallbackPlan.verificationBullets,
    notesBullets: uniqueLines(source.notesBullets, 2),
    refs: normalizedRefs.length > 0 ? normalizedRefs : fallbackPlan.refs,
    questions: normalizeQuestions(source.questions),
    confidence:
      source.confidence === "low" || source.confidence === "medium" || source.confidence === "high"
        ? source.confidence
        : "medium",
  };
}

function cloneCommitPlan(plan) {
  return {
    type: plan.type,
    scope: plan.scope,
    subject: plan.subject,
    whyBullets: [...(plan.whyBullets || [])],
    changeBullets: [...(plan.changeBullets || [])],
    verificationBullets: [...(plan.verificationBullets || [])],
    notesBullets: [...(plan.notesBullets || [])],
    refs: [...(plan.refs || [])],
    questions: [...(plan.questions || [])],
    confidence: plan.confidence || "medium",
  };
}

function appendUniqueBullet(list, bullet) {
  const value = cleanLine(bullet);
  if (!value || list.includes(value)) return;
  list.push(value);
}

function applyAnswersToPlan(plan, questions, answers) {
  const next = cloneCommitPlan(plan);

  for (const question of Array.isArray(questions) ? questions : []) {
    const answer = cleanLine(answers?.[question.id]);
    if (!answer) continue;

    if (question.kind === "why") {
      appendUniqueBullet(next.whyBullets, answer);
      continue;
    }
    if (question.kind === "verification") {
      appendUniqueBullet(next.verificationBullets, answer);
      continue;
    }
    appendUniqueBullet(next.notesBullets, answer);
  }

  return next;
}

function buildCommitMessage({
  type,
  scope,
  subject,
  whyBullets = [],
  changeBullets = [],
  verificationBullets = [],
  notesBullets = [],
  refs = [],
}) {
  const lines = [`${type}(${scope}): ${subject}`];

  if (whyBullets.length > 0) {
    lines.push("", "Why:");
    for (const bullet of whyBullets.slice(0, 4)) {
      lines.push(`- ${bullet}`);
    }
  }

  if (changeBullets.length > 0) {
    lines.push("", "Changes:");
    for (const bullet of changeBullets.slice(0, 6)) {
      lines.push(`- ${bullet}`);
    }
  }

  if (verificationBullets.length > 0) {
    lines.push("", "Verification:");
    for (const bullet of verificationBullets.slice(0, 4)) {
      lines.push(`- ${bullet}`);
    }
  }

  if (notesBullets.length > 0) {
    lines.push("", "Notes:");
    for (const bullet of notesBullets.slice(0, 4)) {
      lines.push(`- ${bullet}`);
    }
  }

  if (refs.length > 0) {
    lines.push("", "Refs:");
    for (const ref of refs.slice(0, 6)) {
      lines.push(`- ${ref}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

module.exports = {
  applyAnswersToPlan,
  buildCommitMessage,
  cleanLine,
  cloneCommitPlan,
  normalizeCommitPlan,
  normalizeQuestions,
  normalizeSubject,
  truncateLine,
  uniqueLines,
};
