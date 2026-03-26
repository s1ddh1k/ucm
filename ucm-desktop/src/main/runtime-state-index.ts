import { summarizeMission } from "../../../packages/application/runtime-core.js";
import type { DatabaseSync } from "node:sqlite";
import type { RuntimeState } from "./runtime-state";

function ensureRuntimeIndexTables(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS runtime_workspace_index (
      store_key TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_key, workspace_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_mission_index (
      store_key TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      workspace_id TEXT,
      title TEXT NOT NULL,
      goal TEXT,
      status TEXT NOT NULL,
      command TEXT,
      line_status TEXT,
      latest_result TEXT,
      artifact_count INTEGER NOT NULL DEFAULT 0,
      attention_required INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_key, mission_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_run_index (
      store_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      budget_class TEXT,
      provider_preference TEXT,
      workspace_command TEXT,
      terminal_provider TEXT,
      session_id TEXT,
      session_transport TEXT,
      session_provider TEXT,
      workspace_mode TEXT,
      workspace_root_path TEXT,
      worktree_path TEXT,
      artifact_count INTEGER NOT NULL DEFAULT 0,
      release_count INTEGER NOT NULL DEFAULT 0,
      handoff_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_key, run_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_release_index (
      store_key TEXT NOT NULL,
      release_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      latest_revision_id TEXT,
      latest_revision_number INTEGER,
      latest_revision_status TEXT,
      revision_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (store_key, release_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_handoff_index (
      store_key TEXT NOT NULL,
      handoff_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      release_revision_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      target TEXT,
      status TEXT NOT NULL,
      PRIMARY KEY (store_key, handoff_id)
    );
  `);

  ensureColumn(database, "runtime_run_index", "session_id", "TEXT");
  ensureColumn(database, "runtime_run_index", "session_transport", "TEXT");
  ensureColumn(database, "runtime_run_index", "session_provider", "TEXT");
  ensureColumn(database, "runtime_run_index", "workspace_mode", "TEXT");
  ensureColumn(database, "runtime_run_index", "workspace_root_path", "TEXT");
  ensureColumn(database, "runtime_run_index", "worktree_path", "TEXT");
}

function ensureColumn(
  database: DatabaseSync,
  tableName: string,
  columnName: string,
  columnType: string,
) {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  database.exec(
    `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`,
  );
}

export function projectRuntimeState(
  database: DatabaseSync,
  storeKey: string,
  state: RuntimeState,
) {
  ensureRuntimeIndexTables(database);

  const deleteWorkspaceRows = database.prepare(
    "DELETE FROM runtime_workspace_index WHERE store_key = ?",
  );
  const deleteMissionRows = database.prepare(
    "DELETE FROM runtime_mission_index WHERE store_key = ?",
  );
  const deleteRunRows = database.prepare(
    "DELETE FROM runtime_run_index WHERE store_key = ?",
  );
  const deleteReleaseRows = database.prepare(
    "DELETE FROM runtime_release_index WHERE store_key = ?",
  );
  const deleteHandoffRows = database.prepare(
    "DELETE FROM runtime_handoff_index WHERE store_key = ?",
  );

  const insertWorkspaceRow = database.prepare(`
    INSERT INTO runtime_workspace_index (
      store_key,
      workspace_id,
      name,
      root_path,
      is_active
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertMissionRow = database.prepare(`
    INSERT INTO runtime_mission_index (
      store_key,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRunRow = database.prepare(`
    INSERT INTO runtime_run_index (
      store_key,
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertReleaseRow = database.prepare(`
    INSERT INTO runtime_release_index (
      store_key,
      release_id,
      mission_id,
      run_id,
      kind,
      title,
      latest_revision_id,
      latest_revision_number,
      latest_revision_status,
      revision_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHandoffRow = database.prepare(`
    INSERT INTO runtime_handoff_index (
      store_key,
      handoff_id,
      mission_id,
      run_id,
      release_revision_id,
      channel,
      target,
      status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN");
  try {
    deleteWorkspaceRows.run(storeKey);
    deleteMissionRows.run(storeKey);
    deleteRunRows.run(storeKey);
    deleteReleaseRows.run(storeKey);
    deleteHandoffRows.run(storeKey);

    for (const workspace of state.workspaces) {
      insertWorkspaceRow.run(
        storeKey,
        workspace.id,
        workspace.name,
        workspace.rootPath,
        workspace.active ? 1 : 0,
      );
    }

    for (const mission of state.missions) {
      const summarizedMission = summarizeMission(state, mission);
      insertMissionRow.run(
        storeKey,
        mission.id,
        state.workspaceIdByMissionId[mission.id] ?? null,
        mission.title,
        mission.goal ?? null,
        mission.status,
        mission.command ?? null,
        summarizedMission.lineStatus ?? null,
        summarizedMission.latestResult ?? null,
        summarizedMission.artifactCount ?? 0,
        summarizedMission.attentionRequired ? 1 : 0,
        mission.id === state.activeMissionId ? 1 : 0,
      );
    }

    for (const [missionId, runs] of Object.entries(state.runsByMissionId)) {
      for (const run of runs) {
        insertRunRow.run(
          storeKey,
          run.id,
          missionId,
          run.agentId,
          run.title,
          run.summary,
          run.status,
          run.budgetClass ?? null,
          run.providerPreference ?? null,
          run.workspaceCommand ?? null,
          run.terminalProvider ?? null,
          run.terminalSessionId ?? null,
          null,
          run.terminalProvider ?? null,
          null,
          null,
          null,
          run.artifacts.length,
          (run.deliverables ?? []).length,
          run.handoffs.length,
          run.id === state.activeRunId ? 1 : 0,
        );

        for (const deliverable of run.deliverables ?? []) {
          const latestRevision =
            deliverable.revisions.find(
              (revision: { id: string }) => revision.id === deliverable.latestRevisionId,
            ) ?? deliverable.revisions.at(-1);
          insertReleaseRow.run(
            storeKey,
            deliverable.id,
            missionId,
            run.id,
            deliverable.kind,
            deliverable.title,
            deliverable.latestRevisionId ?? null,
            latestRevision?.revision ?? null,
            latestRevision?.status ?? null,
            deliverable.revisions.length,
          );
        }

        for (const handoff of run.handoffs) {
          insertHandoffRow.run(
            storeKey,
            handoff.id,
            missionId,
            run.id,
            handoff.deliverableRevisionId,
            handoff.channel,
            handoff.target ?? null,
            handoff.status,
          );
        }
      }
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
