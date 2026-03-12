import type { SpawnAgent, SpawnOpts, Task } from "./types.ts";
import { extractJson } from "./json.ts";

export interface Phase1Opts {
  spawnAgent: SpawnAgent;
  spawnOpts: SpawnOpts;
  projectPath: string;
  onMessage?: (text: string) => void;
  onUserInput?: (prompt: string) => Promise<string>;
  onTaskProposed?: (task: Task) => Promise<boolean>;
}

const SYSTEM_PROMPT = `You are a task definition assistant. Your job is to understand what the user wants to build.

Rules:
- Ask about "what", "who", "why", and important constraints. Never ask for implementation details unless a hard constraint is missing.
- When the goal is clear, output a JSON object with exactly these fields:
  {"goal": "...", "context": "...", "acceptance": "...", "constraints": "..."}
- goal: What to build (concrete and specific)
- context: Who uses it and why
- acceptance: How to verify it's done (observable criteria)
- constraints: Important limits, non-goals, environment constraints, or "none"
- Output ONLY the JSON when ready, no other text around it.`;

function normalizeTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  if (
    typeof task.goal !== "string" ||
    typeof task.context !== "string" ||
    typeof task.acceptance !== "string"
  ) {
    return null;
  }
  return {
    goal: task.goal.trim(),
    context: task.context.trim(),
    acceptance: task.acceptance.trim(),
    constraints:
      typeof task.constraints === "string" ? task.constraints.trim() : "",
  };
}

export async function runPhase1(opts: Phase1Opts): Promise<Task | null> {
  const { spawnAgent, spawnOpts, onMessage, onUserInput, onTaskProposed } = opts;

  let conversationHistory = `${SYSTEM_PROMPT}\n\nProject directory: ${opts.projectPath}\n\nStart by examining the project and asking the user what they want to build.`;

  const maxTurns = 20;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await spawnAgent(conversationHistory, spawnOpts);

    if (result.status !== "ok") {
      return null;
    }

    const text = result.text;
    onMessage?.(text);

    // JSON 태스크 제안 감지
    const task = normalizeTask(extractJson(text));
    if (task && task.goal && task.context && task.acceptance) {
      if (onTaskProposed) {
        const approved = await onTaskProposed(task);
        if (approved) return task;
        // 거부 시 계속 대화
        conversationHistory += `\n\nAssistant: ${text}\n\nUser: Please revise the task. I'd like to adjust the scope.`;
        continue;
      }
      return task;
    }

    // 에이전트가 질문을 했으면 사용자 응답을 받아서 대화 지속
    if (onUserInput) {
      const userResponse = await onUserInput(text);
      conversationHistory += `\n\nAssistant: ${text}\n\nUser: ${userResponse}`;
      continue;
    }

    // onUserInput이 없으면 대화를 이어갈 수 없으므로 종료
    return null;
  }

  return null;
}
