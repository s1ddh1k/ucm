import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

export type RuntimeWorkspaceIndexRow = {
  workspaceId: string;
  name: string;
  rootPath: string;
  isActive: boolean;
};

export type RuntimeMissionIndexRow = {
  missionId: string;
  workspaceId: string | null;
  title: string;
  goal: string | null;
  status: string;
  command: string | null;
  lineStatus: string | null;
  latestResult: string | null;
  artifactCount: number;
  attentionRequired: boolean;
  isActive: boolean;
};

export type RuntimeRunIndexRow = {
  runId: string;
  missionId: string;
  agentId: string;
  title: string;
  summary: string;
  status: string;
  budgetClass: string | null;
  providerPreference: string | null;
  workspaceCommand: string | null;
  terminalProvider: string | null;
  sessionId: string | null;
  sessionTransport: string | null;
  sessionProvider: string | null;
  workspaceMode: string | null;
  workspaceRootPath: string | null;
  worktreePath: string | null;
  artifactCount: number;
  releaseCount: number;
  handoffCount: number;
  isActive: boolean;
};

export type RuntimeReleaseIndexRow = {
  releaseId: string;
  missionId: string;
  runId: string;
  kind: string;
  title: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number | null;
  latestRevisionStatus: string | null;
  revisionCount: number;
};

export type RuntimeHandoffIndexRow = {
  handoffId: string;
  missionId: string;
  runId: string;
  releaseRevisionId: string;
  channel: string;
  target: string | null;
  status: string;
};

export class RuntimeIndexRepository {
  private database: DatabaseSync | null = null;

  constructor(
    private filePath: string,
    private storeKey = "default",
  ) {}

  close() {
    this.database?.close();
    this.database = null;
  }

  listWorkspaces(): RuntimeWorkspaceIndexRow[] {
    const rows = this.safeAll<{
      workspace_id: string;
      name: string;
      root_path: string;
      is_active: number;
    }>(
      `
        SELECT workspace_id, name, root_path, is_active
        FROM runtime_workspace_index
        WHERE store_key = ?
        ORDER BY is_active DESC, name ASC
      `,
      this.storeKey,
    );

    return rows.map((row) => ({
      workspaceId: row.workspace_id,
      name: row.name,
      rootPath: row.root_path,
      isActive: row.is_active === 1,
    }));
  }

  listMissions(input?: {
    workspaceId?: string;
    activeOnly?: boolean;
  }): RuntimeMissionIndexRow[] {
    const clauses = ["store_key = ?"];
    const params: SQLInputValue[] = [this.storeKey];

    if (input?.workspaceId) {
      clauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input?.activeOnly) {
      clauses.push("is_active = 1");
    }

    const rows = this.safeAll<{
      mission_id: string;
      workspace_id: string | null;
      title: string;
      goal: string | null;
      status: string;
      command: string | null;
      line_status: string | null;
      latest_result: string | null;
      artifact_count: number;
      attention_required: number;
      is_active: number;
    }>(
      `
        SELECT
          mission_id,
          workspace_id,
          title,
          goal,
          status,
          command,
          line_status,
          latest_result,
          artifact_count,
          attention_required,
          is_active
        FROM runtime_mission_index
        WHERE ${clauses.join(" AND ")}
        ORDER BY is_active DESC, title ASC
      `,
      ...params,
    );

    return rows.map((row) => ({
      missionId: row.mission_id,
      workspaceId: row.workspace_id,
      title: row.title,
      goal: row.goal,
      status: row.status,
      command: row.command,
      lineStatus: row.line_status,
      latestResult: row.latest_result,
      artifactCount: row.artifact_count,
      attentionRequired: row.attention_required === 1,
      isActive: row.is_active === 1,
    }));
  }

  getActiveMission(): RuntimeMissionIndexRow | null {
    return this.listMissions({ activeOnly: true })[0] ?? null;
  }

  listRuns(input?: {
    missionId?: string;
    activeOnly?: boolean;
  }): RuntimeRunIndexRow[] {
    const clauses = ["store_key = ?"];
    const params: SQLInputValue[] = [this.storeKey];

    if (input?.missionId) {
      clauses.push("mission_id = ?");
      params.push(input.missionId);
    }
    if (input?.activeOnly) {
      clauses.push("is_active = 1");
    }

    const rows = this.safeAll<{
      run_id: string;
      mission_id: string;
      agent_id: string;
      title: string;
      summary: string;
      status: string;
      budget_class: string | null;
      provider_preference: string | null;
      workspace_command: string | null;
      terminal_provider: string | null;
      session_id: string | null;
      session_transport: string | null;
      session_provider: string | null;
      workspace_mode: string | null;
      workspace_root_path: string | null;
      worktree_path: string | null;
      artifact_count: number;
      release_count: number;
      handoff_count: number;
      is_active: number;
    }>(
      `
        SELECT
          run_id,
          mission_id,
          agent_id,
          title,
          summary,
          status,
          budget_class,
          provider_preference,
          workspace_command,
          terminal_provider,
          session_id,
          session_transport,
          session_provider,
          workspace_mode,
          workspace_root_path,
          worktree_path,
          artifact_count,
          release_count,
          handoff_count,
          is_active
        FROM runtime_run_index
        WHERE ${clauses.join(" AND ")}
        ORDER BY is_active DESC, title ASC
      `,
      ...params,
    );

    return rows.map((row) => ({
      runId: row.run_id,
      missionId: row.mission_id,
      agentId: row.agent_id,
      title: row.title,
      summary: row.summary,
      status: row.status,
      budgetClass: row.budget_class,
      providerPreference: row.provider_preference,
      workspaceCommand: row.workspace_command,
      terminalProvider: row.terminal_provider,
      sessionId: row.session_id,
      sessionTransport: row.session_transport,
      sessionProvider: row.session_provider,
      workspaceMode: row.workspace_mode,
      workspaceRootPath: row.workspace_root_path,
      worktreePath: row.worktree_path,
      artifactCount: row.artifact_count,
      releaseCount: row.release_count,
      handoffCount: row.handoff_count,
      isActive: row.is_active === 1,
    }));
  }

  getActiveRun(): RuntimeRunIndexRow | null {
    return this.listRuns({ activeOnly: true })[0] ?? null;
  }

  listReleases(input?: {
    missionId?: string;
    runId?: string;
  }): RuntimeReleaseIndexRow[] {
    const clauses = ["store_key = ?"];
    const params: SQLInputValue[] = [this.storeKey];

    if (input?.missionId) {
      clauses.push("mission_id = ?");
      params.push(input.missionId);
    }
    if (input?.runId) {
      clauses.push("run_id = ?");
      params.push(input.runId);
    }

    const rows = this.safeAll<{
      release_id: string;
      mission_id: string;
      run_id: string;
      kind: string;
      title: string;
      latest_revision_id: string | null;
      latest_revision_number: number | null;
      latest_revision_status: string | null;
      revision_count: number;
    }>(
      `
        SELECT
          release_id,
          mission_id,
          run_id,
          kind,
          title,
          latest_revision_id,
          latest_revision_number,
          latest_revision_status,
          revision_count
        FROM runtime_release_index
        WHERE ${clauses.join(" AND ")}
        ORDER BY title ASC
      `,
      ...params,
    );

    return rows.map((row) => ({
      releaseId: row.release_id,
      missionId: row.mission_id,
      runId: row.run_id,
      kind: row.kind,
      title: row.title,
      latestRevisionId: row.latest_revision_id,
      latestRevisionNumber: row.latest_revision_number,
      latestRevisionStatus: row.latest_revision_status,
      revisionCount: row.revision_count,
    }));
  }

  listHandoffs(input?: {
    missionId?: string;
    runId?: string;
  }): RuntimeHandoffIndexRow[] {
    const clauses = ["store_key = ?"];
    const params: SQLInputValue[] = [this.storeKey];

    if (input?.missionId) {
      clauses.push("mission_id = ?");
      params.push(input.missionId);
    }
    if (input?.runId) {
      clauses.push("run_id = ?");
      params.push(input.runId);
    }

    const rows = this.safeAll<{
      handoff_id: string;
      mission_id: string;
      run_id: string;
      release_revision_id: string;
      channel: string;
      target: string | null;
      status: string;
    }>(
      `
        SELECT
          handoff_id,
          mission_id,
          run_id,
          release_revision_id,
          channel,
          target,
          status
        FROM runtime_handoff_index
        WHERE ${clauses.join(" AND ")}
        ORDER BY handoff_id ASC
      `,
      ...params,
    );

    return rows.map((row) => ({
      handoffId: row.handoff_id,
      missionId: row.mission_id,
      runId: row.run_id,
      releaseRevisionId: row.release_revision_id,
      channel: row.channel,
      target: row.target,
      status: row.status,
    }));
  }

  private getDatabase(): DatabaseSync | null {
    if (this.database) {
      return this.database;
    }
    if (!fs.existsSync(this.filePath)) {
      return null;
    }

    this.database = new DatabaseSync(this.filePath);
    return this.database;
  }

  private safeAll<TRow>(query: string, ...params: SQLInputValue[]): TRow[] {
    const database = this.getDatabase();
    if (!database) {
      return [];
    }

    try {
      return database.prepare(query).all(...params) as TRow[];
    } catch {
      return [];
    }
  }
}
