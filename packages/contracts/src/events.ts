import type {
  ArtifactRecord,
  HandoffRecord,
  MissionRecord,
  ReleaseRecord,
  ReviewRecord,
  RunRecord,
  SteeringRecord,
  WorkspaceRecord,
} from "./records";

export interface CoreEventEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  createdAt: string;
  payload: TPayload;
}

export type WorkspaceCreatedEvent = CoreEventEnvelope<
  "workspace.created",
  { workspace: WorkspaceRecord }
>;

export type MissionCreatedEvent = CoreEventEnvelope<
  "mission.created",
  { mission: MissionRecord }
>;

export type RunStartedEvent = CoreEventEnvelope<
  "run.started",
  { run: RunRecord }
>;

export type ArtifactAttachedEvent = CoreEventEnvelope<
  "artifact.attached",
  { artifact: ArtifactRecord }
>;

export type ReleaseCreatedEvent = CoreEventEnvelope<
  "release.created",
  { release: ReleaseRecord }
>;

export type ReleaseApprovedEvent = CoreEventEnvelope<
  "release.approved",
  { release: ReleaseRecord; review: ReviewRecord }
>;

export type ReleaseShippedEvent = CoreEventEnvelope<
  "release.shipped",
  { release: ReleaseRecord }
>;

export type HandoffRecordedEvent = CoreEventEnvelope<
  "handoff.recorded",
  { handoff: HandoffRecord }
>;

export type SteeringSubmittedEvent = CoreEventEnvelope<
  "steering.submitted",
  { steering: SteeringRecord }
>;

export type CoreEvent =
  | WorkspaceCreatedEvent
  | MissionCreatedEvent
  | RunStartedEvent
  | ArtifactAttachedEvent
  | ReleaseCreatedEvent
  | ReleaseApprovedEvent
  | ReleaseShippedEvent
  | HandoffRecordedEvent
  | SteeringSubmittedEvent;
