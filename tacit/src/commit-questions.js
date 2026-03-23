const readline = require("node:readline");
const { isCodePath, isTestPath } = require("./checks");

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function getChangeCategories(stagedFiles) {
  const categories = new Set();
  for (const filePath of stagedFiles) {
    if (isCodePath(filePath)) categories.add("code");
    if (isTestPath(filePath)) categories.add("test");
    if (filePath.startsWith("docs/")) categories.add("docs");
    if (filePath.startsWith(".githooks/")) categories.add("hooks");
    if (filePath.startsWith(".github/workflows/")) categories.add("ci");
    if (filePath === "package.json") categories.add("build");
  }
  return [...categories];
}

function buildFallbackQuestions({ stagedFiles, stagedDiff, inspection, context }) {
  const questions = [];
  const categories = getChangeCategories(stagedFiles);
  const topLevelGroups = unique(stagedFiles.map((filePath) => filePath.split("/")[0]));
  const hasCode = stagedFiles.some((filePath) => isCodePath(filePath));

  if (inspection.findings.some((finding) => finding.code === "needs-decision-doc")) {
    questions.push({
      id: "decision_rationale",
      kind: "why",
      question: "이 변경에서 가장 중요한 결정사항은 무엇이었나요? 왜 그 결정을 했나요?",
    });
  }

  if (inspection.findings.some((finding) => finding.code === "needs-test-evidence")) {
    questions.push({
      id: "test_gap",
      kind: "verification",
      question: "이 커밋에 테스트가 없는 이유는 뭔가요? 비동작 변경인가요, 다른 방식으로 검증했나요, 아직 미검증인가요?",
    });
  }

  if (inspection.findings.some((finding) => finding.code === "needs-handoff")) {
    questions.push({
      id: "checkpoint_state",
      kind: "notes",
      question: "이 커밋은 체크포인트 성격인가요? 그렇다면 아직 남은 작업이나 다음 액션은 무엇인가요?",
    });
  }

  if (hasCode && context.bullets.length === 0) {
    questions.push({
      id: "main_intent",
      kind: "why",
      question: "이 커밋의 핵심 의도는 무엇인가요? 이 변경이 왜 필요한가요?",
    });
  }

  if (topLevelGroups.length >= 3 || categories.length >= 3) {
    questions.push({
      id: "mixed_scope",
      kind: "notes",
      question: "이 커밋은 여러 관심사를 함께 바꾸고 있습니다. 의도적으로 한 커밋으로 묶은 이유가 있나요?",
    });
  }

  if (/alternative|option|fallback|trade.?off/i.test(stagedDiff) === false && hasCode) {
    questions.push({
      id: "alternatives",
      kind: "why",
      question: "이 변경에서 고려했던 대안이 있었나요? 있었다면 왜 버렸나요?",
    });
  }

  return unique(questions.map((question) => question.id)).map((id) =>
    questions.find((question) => question.id === id),
  );
}

function askQuestions(questions) {
  return new Promise((resolve) => {
    if (questions.length === 0 || !process.stdin.isTTY) {
      resolve({});
      return;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    const answers = {};
    let index = 0;

    const askNext = () => {
      if (index >= questions.length) {
        rl.close();
        resolve(answers);
        return;
      }

      const question = questions[index];
      rl.question(`Tacit: ${question.question}\n> `, (answer) => {
        answers[question.id] = answer.trim();
        index++;
        askNext();
      });
    };

    askNext();
  });
}

function hasAnswers(answers) {
  return Object.values(answers || {}).some((answer) => String(answer || "").trim());
}

module.exports = {
  askQuestions,
  buildFallbackQuestions,
  getChangeCategories,
  hasAnswers,
  unique,
};
