import fs from "node:fs";
import path from "node:path";

export type RuntimeStateChangeReason =
  | "state_changed"
  | "autopilot_applied"
  | "terminal_updated"
  | "run_completed";

export interface RuntimeStoreLike<TState> {
  read(): TState;
  write(state: TState): void;
}

export class RuntimeStore<TState> implements RuntimeStoreLike<TState> {
  constructor(
    private filePath: string,
    private seedFactory: () => TState,
    private hydrate: (parsed: Partial<TState>, seed: TState) => TState,
    private onStateChange?: (reason: RuntimeStateChangeReason) => void,
  ) {}

  read(): TState {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TState>;
      return this.hydrate(parsed, this.seedFactory());
    } catch {
      const initial = this.seedFactory();
      this.write(initial);
      return initial;
    }
  }

  write(state: TState) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    this.onStateChange?.("state_changed");
  }
}

export class MemoryRuntimeStore<TState> implements RuntimeStoreLike<TState> {
  private state: TState;

  constructor(
    seedFactory: () => TState,
    private onStateChange?: (reason: RuntimeStateChangeReason) => void,
  ) {
    this.state = seedFactory();
  }

  read(): TState {
    return this.state;
  }

  write(state: TState) {
    this.state = state;
    this.onStateChange?.("state_changed");
  }
}
