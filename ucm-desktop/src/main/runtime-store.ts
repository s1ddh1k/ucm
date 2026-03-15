import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type RuntimeStateChangeReason =
  | "state_changed"
  | "autopilot_applied"
  | "terminal_updated"
  | "run_completed";

type RuntimeStoreOptions<TState> = {
  legacyJsonPath?: string;
  storeKey?: string;
  projectState?: (
    database: DatabaseSync,
    storeKey: string,
    state: TState,
  ) => void;
};

export interface RuntimeStoreLike<TState> {
  read(): TState;
  write(state: TState): void;
}

export class RuntimeStore<TState> implements RuntimeStoreLike<TState> {
  private database: DatabaseSync | null = null;
  private readonly storeKey: string;

  constructor(
    private filePath: string,
    private seedFactory: () => TState,
    private hydrate: (parsed: Partial<TState>, seed: TState) => TState,
    private onStateChange?: (reason: RuntimeStateChangeReason) => void,
    private options: RuntimeStoreOptions<TState> = {},
  ) {
    this.storeKey = options.storeKey ?? "default";
  }

  read(): TState {
    try {
      this.migrateLegacyJsonIfNeeded();
      const row = this.readRow();
      if (row?.state_json) {
        return this.deserialize(row.state_json);
      }
    } catch {
      // Fall through to seed creation below.
    }

    const initial = this.seedFactory();
    this.write(initial);
    return initial;
  }

  write(state: TState) {
    this.persistState(state, true);
  }

  private getDatabase(): DatabaseSync {
    if (this.database) {
      return this.database;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const database = new DatabaseSync(this.filePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS runtime_state_store (
        store_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.database = database;
    return database;
  }

  private readRow():
    | {
        state_json: string;
      }
    | null {
    const row = this.getDatabase()
      .prepare(
        "SELECT state_json FROM runtime_state_store WHERE store_key = ? LIMIT 1",
      )
      .get(this.storeKey) as { state_json: string } | undefined;

    return row ?? null;
  }

  private deserialize(raw: string): TState {
    try {
      const parsed = JSON.parse(raw) as Partial<TState>;
      return this.hydrate(parsed, this.seedFactory());
    } catch {
      const initial = this.seedFactory();
      this.persistState(initial, false);
      return initial;
    }
  }

  private persistState(state: TState, emitChange: boolean) {
    const now = new Date().toISOString();
    const serialized = JSON.stringify(state);
    const database = this.getDatabase();
    database
      .prepare(`
        INSERT INTO runtime_state_store (
          store_key,
          state_json,
          schema_version,
          created_at,
          updated_at
        ) VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(store_key) DO UPDATE SET
          state_json = excluded.state_json,
          schema_version = excluded.schema_version,
          updated_at = excluded.updated_at
      `)
      .run(this.storeKey, serialized, now, now);
    this.options.projectState?.(database, this.storeKey, state);

    if (emitChange) {
      this.onStateChange?.("state_changed");
    }
  }

  private migrateLegacyJsonIfNeeded() {
    const legacyJsonPath = this.options.legacyJsonPath;
    if (!legacyJsonPath || this.readRow()) {
      return;
    }

    try {
      const raw = fs.readFileSync(legacyJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TState>;
      const migrated = this.hydrate(parsed, this.seedFactory());
      this.persistState(migrated, false);
    } catch {
      // Ignore missing or invalid legacy JSON and let the seeded state initialize instead.
    }
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
