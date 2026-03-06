import { describe, it, assert } from "./harness.ts";
import { runPhase1 } from "../src/phase1.ts";
import type { SpawnAgent, SpawnResult, Task } from "../src/types.ts";

function mockAgent(responses: SpawnResult[]): SpawnAgent {
  let call = 0;
  return async () => responses[Math.min(call++, responses.length - 1)];
}

function okResult(text: string): SpawnResult {
  return { status: "ok", text, exitCode: 0, durationMs: 100 };
}

describe("phase1.ts", () => {
  it("extracts task from first response containing JSON", async () => {
    const json = JSON.stringify({
      goal: "Build a CLI tool",
      context: "Developers use it daily",
      acceptance: "Can parse arguments and output results",
      constraints: "Do not introduce a daemon",
    });
    const agent = mockAgent([okResult(`Here's the task:\n\`\`\`json\n${json}\n\`\`\``)]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
    });

    assert(task !== null);
    assert.equal(task!.goal, "Build a CLI tool");
    assert.equal(task!.context, "Developers use it daily");
    assert.equal(task!.constraints, "Do not introduce a daemon");
  });

  it("returns null on spawn error", async () => {
    const agent = mockAgent([{ status: "error", text: "fail", exitCode: 1, durationMs: 50 }]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
    });

    assert.equal(task, null);
  });

  it("calls onMessage with response text", async () => {
    const json = JSON.stringify({
      goal: "Test",
      context: "Testing",
      acceptance: "Tests pass",
    });
    const agent = mockAgent([okResult(`Task:\n${json}`)]);
    const messages: string[] = [];

    await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onMessage: (text) => messages.push(text),
    });

    assert.equal(messages.length, 1);
    assert.includes(messages[0], "Test");
  });

  it("calls onTaskProposed and returns task on approval", async () => {
    const json = JSON.stringify({
      goal: "Feature X",
      context: "Users",
      acceptance: "Works",
    });
    const agent = mockAgent([okResult(json)]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onTaskProposed: async () => true,
    });

    assert(task !== null);
    assert.equal(task!.goal, "Feature X");
  });

  it("continues conversation on task rejection", async () => {
    const json1 = JSON.stringify({ goal: "V1", context: "Ctx", acceptance: "Acc" });
    const json2 = JSON.stringify({ goal: "V2", context: "Ctx2", acceptance: "Acc2" });
    let proposalCount = 0;

    const agent = mockAgent([okResult(json1), okResult(json2)]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onTaskProposed: async () => {
        proposalCount++;
        return proposalCount >= 2;
      },
    });

    assert(task !== null);
    assert.equal(task!.goal, "V2");
    assert.equal(proposalCount, 2);
  });

  it("returns null when no onUserInput and response is not JSON", async () => {
    const agent = mockAgent([okResult("What would you like to build?")]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
    });

    assert.equal(task, null);
  });

  it("ignores incomplete task JSON (missing fields)", async () => {
    const agent = mockAgent([okResult('{"goal":"Only goal"}')]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
    });

    assert.equal(task, null);
  });

  it("normalizes missing constraints to empty string", async () => {
    const agent = mockAgent([
      okResult(
        JSON.stringify({
          goal: "Simple task",
          context: "Users",
          acceptance: "Done",
        }),
      ),
    ]);

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
    });

    assert(task !== null);
    assert.equal(task!.constraints, "");
  });

  // --- 멀티턴 대화 테스트 ---

  it("multi-turn: agent asks question → user responds → agent proposes task", async () => {
    const json = JSON.stringify({
      goal: "Auth system",
      context: "Web app users",
      acceptance: "Login/logout works",
    });

    let callCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      callCount++;
      if (callCount === 1) {
        return okResult("What kind of app are you building?");
      }
      // 사용자 응답을 받은 후 태스크 제안
      assert.includes(prompt, "A web app with user accounts");
      return okResult(json);
    };

    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onUserInput: async () => "A web app with user accounts",
      onTaskProposed: async () => true,
    });

    assert(task !== null);
    assert.equal(task!.goal, "Auth system");
    assert.equal(callCount, 2);
  });

  it("multi-turn: 3-turn conversation before task proposal", async () => {
    const json = JSON.stringify({
      goal: "REST API",
      context: "Mobile clients",
      acceptance: "CRUD endpoints return JSON",
    });

    let callCount = 0;
    const userResponses = ["An API server", "Mobile apps will consume it", "CRUD for users and posts"];

    const agent: SpawnAgent = async () => {
      callCount++;
      if (callCount <= 3) {
        return okResult(`Question ${callCount}: Tell me more.`);
      }
      return okResult(json);
    };

    let inputCount = 0;
    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onUserInput: async () => userResponses[inputCount++],
      onTaskProposed: async () => true,
    });

    assert(task !== null);
    assert.equal(task!.goal, "REST API");
    assert.equal(callCount, 4);
    assert.equal(inputCount, 3);
  });

  it("multi-turn: conversation history accumulates in prompt", async () => {
    const json = JSON.stringify({
      goal: "Chat feature",
      context: "Users",
      acceptance: "Messages are sent",
    });

    const prompts: string[] = [];
    let callCount = 0;

    const agent: SpawnAgent = async (prompt) => {
      prompts.push(prompt);
      callCount++;
      if (callCount === 1) return okResult("What do you want to build?");
      if (callCount === 2) return okResult("Who is this for?");
      return okResult(json);
    };

    await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onUserInput: async (text) => {
        if (text.includes("What")) return "A chat app";
        return "My team";
      },
      onTaskProposed: async () => true,
    });

    // 3번째 프롬프트에 이전 대화가 모두 포함
    assert.includes(prompts[2], "What do you want to build?");
    assert.includes(prompts[2], "A chat app");
    assert.includes(prompts[2], "Who is this for?");
    assert.includes(prompts[2], "My team");
  });

  it("multi-turn: rejection + user input continues conversation", async () => {
    const json1 = JSON.stringify({ goal: "V1", context: "Ctx", acceptance: "Acc" });
    const json2 = JSON.stringify({ goal: "V2", context: "Ctx", acceptance: "Acc" });

    let callCount = 0;
    const agent: SpawnAgent = async () => {
      callCount++;
      if (callCount === 1) return okResult("What do you want?");
      if (callCount === 2) return okResult(json1);
      return okResult(json2);
    };

    let proposalCount = 0;
    const task = await runPhase1({
      spawnAgent: agent,
      spawnOpts: { cwd: "/tmp", provider: "claude" },
      projectPath: "/tmp/project",
      onUserInput: async () => "Build something",
      onTaskProposed: async () => {
        proposalCount++;
        return proposalCount >= 2;
      },
    });

    assert(task !== null);
    assert.equal(task!.goal, "V2");
    assert.equal(proposalCount, 2);
  });
});
