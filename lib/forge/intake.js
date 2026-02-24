const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { llmJson } = require("../core/llm");
const { STAGE_MODELS, FORGE_PIPELINES } = require("../core/constants");
const { saveArtifact, initArtifacts } = require("../core/worktree");

const INTAKE_PROMPT = `다음 작업 요청을 분석하고 분류하세요.

## 분류 기준

complexity (복잡도):
  trivial — 단일 파일 수정, 간단한 버그 수정, README 업데이트 등
  small — 몇 개 파일 수정, 명확한 범위의 기능 추가/변경
  medium — 여러 파일에 걸친 기능 구현, 설계 결정 필요
  large — 여러 모듈에 걸친 대규모 기능, 아키텍처 변경

kind (유형):
  feature — 새 기능 추가
  bugfix — 버그 수정
  refactor — 코드 구조 개선
  research — 조사/분석

## 응답 형식 (반드시 JSON만 출력)

### 예시:
{
  "complexity": "medium",
  "kind": "feature",
  "title": "사용자 인증 시스템 추가",
  "summary": "JWT 기반 로그인/로그아웃 기능을 구현하고 미들웨어로 보호된 라우트를 추가한다."
}

### 거부되는 응답:
- complexity/kind가 위 값 중 하나가 아닌 경우
- JSON이 아닌 텍스트`;

async function run(input, { taskId, onLog = () => {} } = {}) {
  if (!input || (typeof input === "string" && !input.trim())) {
    throw new Error("input required: cannot classify empty task request");
  }
  let inputText = input;

  if (input?.endsWith(".md")) {
    const { access } = require("node:fs/promises");
    const resolvedPath = path.resolve(input);
    try {
      await access(resolvedPath);
      inputText = await readFile(resolvedPath, "utf-8");
    } catch (e) {
      if (e.code === "ENOENT") {
        // 파일이 아닌 일반 텍스트 (.md로 끝나는 문자열)
      } else {
        throw new Error(
          `파일을 읽을 수 없습니다: ${input} (${e.code || e.message})`,
        );
      }
    }
  }

  const model = STAGE_MODELS.intake;
  const prompt = `${INTAKE_PROMPT}\n\n## 작업 요청\n\n${inputText}`;

  onLog(`[intake] classifying input...`);

  const { data: result, tokenUsage } = await llmJson(prompt, {
    model,
    allowTools: "",
  });

  const rawComplexity = result.complexity || "small";
  const complexity = FORGE_PIPELINES[rawComplexity] ? rawComplexity : "small";
  const kind = result.kind || "feature";
  const title = result.title || inputText.slice(0, 80);
  const summary = result.summary || inputText.slice(0, 200);

  onLog(`[intake] complexity=${complexity}, kind=${kind}, title="${title}"`);

  await initArtifacts(
    taskId,
    `# ${title}\n\n${summary}\n\n---\n\n${inputText}`,
  );
  await saveArtifact(
    taskId,
    "intake.json",
    JSON.stringify({ complexity, kind, title, summary }, null, 2),
  );

  return { complexity, kind, title, summary, tokenUsage };
}

module.exports = { run };
