// test/helpers/gemini-runner.js — Browser agent E2E runner
// lib/core/browser-agent.js를 래핑하여 테스트 하네스에 맞게 제공

const { browserAgentBatch } = require("../../lib/core/browser-agent");

class GeminiRunner {
  constructor(opts = {}) {
    this.systemPrompt = null;
    this.provider = opts.provider || process.env.UCM_BROWSER_AGENT_PROVIDER || "gemini";
    this.model = opts.model || process.env.UCM_BROWSER_AGENT_MODEL
      || (this.provider === "codex" ? "low" : undefined);
    this.perTaskTimeoutMs = Number(process.env.UCM_BROWSER_AGENT_PER_TASK_TIMEOUT_MS)
      || (this.provider === "codex" ? 20_000 : 30_000);
    this.batchSize = Number(process.env.UCM_BROWSER_AGENT_BATCH_SIZE)
      || (this.provider === "codex" ? 1 : 0);
  }

  async start() {
    // browser-agent가 내부에서 provider CLI 확인 + workDir 생성을 처리하므로
    // 여기서는 별도 초기화 불필요
  }

  /**
   * 모든 테스트를 단일 브라우저 에이전트 spawn으로 배치 실행
   */
  async runBatch(testCases, systemPrompt) {
    const url = testCases[0]?.instruction?.match(/https?:\/\/[^\s]+/)?.[0] || "";

    const tasks = testCases.map((tc) => ({
      id: tc.id,
      instruction: tc.instruction.trim(),
    }));

    const chunkSize = this.batchSize > 0 ? this.batchSize : tasks.length;
    if (chunkSize >= tasks.length) {
      return browserAgentBatch(url, tasks, {
        provider: this.provider,
        model: this.model,
        systemPrompt,
        perTaskTimeoutMs: this.perTaskTimeoutMs,
      });
    }

    const out = [];
    const totalChunks = Math.ceil(tasks.length / chunkSize);
    for (let i = 0; i < tasks.length; i += chunkSize) {
      const chunk = tasks.slice(i, i + chunkSize);
      const chunkIndex = Math.floor(i / chunkSize) + 1;
      console.log(`[browser-runner] chunk ${chunkIndex}/${totalChunks} (${chunk.length} tasks)`);

      let chunkResult = await browserAgentBatch(url, chunk, {
        provider: this.provider,
        model: this.model,
        systemPrompt,
        perTaskTimeoutMs: this.perTaskTimeoutMs,
      });

      if (this.provider === "codex") {
        const failedIds = new Set(chunkResult.filter((r) => !r.pass).map((r) => r.id));
        if (failedIds.size > 0) {
          const retryTasks = chunk.filter((t) => failedIds.has(t.id));
          console.log(`[browser-runner] retry failed tasks once (${retryTasks.length})`);
          const retryById = new Map();
          for (const task of retryTasks) {
            console.log(`[browser-runner] retry task ${task.id}`);
            const retried = await browserAgentBatch(url, [task], {
              provider: this.provider,
              model: this.model,
              systemPrompt,
              perTaskTimeoutMs: Math.max(this.perTaskTimeoutMs, 30_000),
              startupTimeoutBufferMs: 180_000,
            });
            let retryResult = retried[0] || {
              id: task.id,
              pass: false,
              evidence: "retry returned no result",
            };
            if (!retryResult.pass && typeof retryResult.evidence === "string" && retryResult.evidence.startsWith("codex timeout:")) {
              console.log(`[browser-runner] retry task ${task.id} second attempt (timeout)`);
              const retriedAgain = await browserAgentBatch(url, [task], {
                provider: this.provider,
                model: this.model,
                systemPrompt,
                perTaskTimeoutMs: Math.max(this.perTaskTimeoutMs, 40_000),
                startupTimeoutBufferMs: 240_000,
              });
              retryResult = retriedAgain[0] || retryResult;
            }
            retryById.set(task.id, retryResult);
          }
          chunkResult = chunkResult.map((r) => retryById.get(r.id) || r);
        }
      }

      out.push(...chunkResult);
    }
    return out;
  }

  async stop() {
    // cleanup은 browser-agent가 내부에서 처리
  }
}

module.exports = { GeminiRunner };
