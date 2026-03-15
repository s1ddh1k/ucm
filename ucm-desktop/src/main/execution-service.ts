import { ClaudeAdapter } from "./providers/claude-adapter";
import { CodexAdapter } from "./providers/codex-adapter";
import { LocalAdapter } from "./providers/local-adapter";
import type { ProviderName } from "./provider-adapter";
import type {
  ExecutionController,
  ProviderAdapterRegistry,
  TerminalSessionController,
} from "./execution-types";

function createDefaultTerminalSessionService(): TerminalSessionController {
  const module = require("./terminal-session-service") as typeof import("./terminal-session-service");
  return new module.TerminalSessionService();
}

function createDefaultWorktreeManager() {
  const module = require("../../../packages/execution/git-worktree-manager.js");
  return new module.GitWorktreeManager();
}

export class ExecutionService implements ExecutionController {
  private readonly engine: any;

  constructor(options?: {
    providerAdapters?: ProviderAdapterRegistry;
    terminalSessionService?: TerminalSessionController;
    providerLimits?: Partial<Record<ProviderName, number>>;
    worktreeManager?: unknown;
  }) {
    const executionModule = require("../../../packages/execution/runtime-engine.js");
    const providerAdapters =
      options?.providerAdapters ??
      ({
        claude: new ClaudeAdapter(),
        codex: new CodexAdapter(),
        local: new LocalAdapter(),
      } satisfies ProviderAdapterRegistry);

    this.engine = new executionModule.RuntimeExecutionEngine({
      providerAdapters,
      terminalSessionController:
        options?.terminalSessionService ?? createDefaultTerminalSessionService(),
      providerLimits: options?.providerLimits,
      worktreeManager: options?.worktreeManager ?? createDefaultWorktreeManager(),
    });
  }

  spawnAgentRun(input: Parameters<ExecutionController["spawnAgentRun"]>[0]) {
    return this.engine.spawnAgentRun(input);
  }

  writeTerminalSession(sessionId: string, data: string) {
    return this.engine.writeTerminalSession(sessionId, data);
  }

  resizeTerminalSession(sessionId: string, cols: number, rows: number) {
    return this.engine.resizeTerminalSession(sessionId, cols, rows);
  }

  killTerminalSession(sessionId: string) {
    this.engine.killTerminalSession(sessionId);
  }
}
