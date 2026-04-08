import pty from "node-pty";
import type { ProviderName } from "./provider-adapter";
import type {
  StartTerminalSessionInput,
  TerminalSessionController,
} from "./execution-types";

type TerminalSession = {
  id: string;
  process: pty.IPty;
  provider: ProviderName;
  activeRequest: {
    onData: (chunk: string) => void;
    onExit: (result: { exitCode: number; signal: number }) => void;
  } | null;
};

export class TerminalSessionService implements TerminalSessionController {
  private sessions = new Map<string, TerminalSession>();

  startSession(input: StartTerminalSessionInput): string {
    const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const terminal = pty.spawn(input.command.cmd, input.command.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd: input.command.cwd || process.cwd(),
      env,
    });

    this.sessions.set(sessionId, {
      id: sessionId,
      process: terminal,
      provider: input.provider,
      activeRequest: {
        onData: input.onData,
        onExit: input.onExit,
      },
    });

    terminal.onData((chunk) => {
      const session = this.sessions.get(sessionId);
      session?.activeRequest?.onData(chunk);
    });

    terminal.onExit(({ exitCode, signal }) => {
      const session = this.sessions.get(sessionId);
      this.sessions.delete(sessionId);
      session?.activeRequest?.onExit({ exitCode, signal: signal ?? -1 });
    });

    terminal.write(input.prompt);
    terminal.write("\u0004");
    return sessionId;
  }

  resumeSession(input: StartTerminalSessionInput & { sessionId: string }) {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.provider !== input.provider || session.activeRequest) {
      return false;
    }
    session.activeRequest = {
      onData: input.onData,
      onExit: (result) => {
        session.activeRequest = null;
        input.onExit(result);
      },
    };
    session.process.write(input.prompt);
    session.process.write("\u0004");
    return true;
  }

  killSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.process.kill();
    this.sessions.delete(sessionId);
  }

  writeToSession(sessionId: string, data: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.process.write(data);
    return true;
  }

  resizeSession(sessionId: string, cols: number, rows: number) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.process.resize(cols, rows);
    return true;
  }
}
