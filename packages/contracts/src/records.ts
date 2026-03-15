export type EngineName = "claude" | "codex" | "local";

export type MissionStatus =
  | "queued"
  | "running"
  | "review"
  | "blocked"
  | "completed"
  | "cancelled";

export type RunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus = "todo" | "running" | "blocked" | "completed" | "failed";

export type StepName =
  | "intake"
  | "clarify"
  | "specify"
  | "decompose"
  | "design"
  | "implement"
  | "verify"
  | "ux_review"
  | "polish"
  | "integrate"
  | "deliver";

export type ArtifactKind =
  | "diff"
  | "report"
  | "test_result"
  | "log"
  | "snapshot"
  | "handoff_note";

export type ReleaseStatus =
  | "draft"
  | "candidate"
  | "approved"
  | "shipped"
  | "superseded";

export type HandoffChannel = "inbox" | "export" | "share";

export type HandoffStatus = "active" | "accepted" | "superseded" | "revoked";

export type ReviewStatus = "pending" | "approved" | "rejected";

export type SteeringStatus = "active" | "resolved" | "superseded";

export type SessionStatus = "ready" | "running" | "closed" | "failed";

export type NoteSourceType =
  | "mission"
  | "run"
  | "artifact"
  | "release"
  | "manual";

export interface WorkspaceRecord {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface MissionRecord {
  id: string;
  workspaceId: string;
  title: string;
  goal: string;
  status: MissionStatus;
  milestone?: string;
  versionTarget?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  missionId: string;
  title: string;
  summary: string;
  status: RunStatus;
  engine?: EngineName;
  parentRunId?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StepRecord {
  id: string;
  runId: string;
  name: StepName;
  status: StepStatus;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: ArtifactKind;
  title: string;
  summary: string;
  uri?: string;
  createdAt: string;
}

export interface ReleaseRecord {
  id: string;
  missionId: string;
  runId: string;
  version: string;
  milestone?: string;
  title: string;
  summary: string;
  status: ReleaseStatus;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface HandoffRecord {
  id: string;
  releaseId: string;
  channel: HandoffChannel;
  target?: string;
  status: HandoffStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRecord {
  id: string;
  releaseId: string;
  reviewer?: string;
  status: ReviewStatus;
  feedback?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SteeringRecord {
  id: string;
  runId: string;
  text: string;
  status: SteeringStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  runId: string;
  engine: EngineName;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
}

export interface NoteRecord {
  id: string;
  sourceType: NoteSourceType;
  sourceId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
