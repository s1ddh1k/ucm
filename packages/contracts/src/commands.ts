import type {
  ArtifactRecord,
  EngineName,
  HandoffChannel,
  ReleaseRecord,
} from "./records";

export interface CreateWorkspaceCommand {
  name: string;
  rootPath: string;
}

export interface CreateMissionCommand {
  workspaceId: string;
  title: string;
  goal: string;
  milestone?: string;
  versionTarget?: string;
}

export interface StartRunCommand {
  missionId: string;
  title: string;
  engine?: EngineName;
  parentRunId?: string;
}

export interface AttachArtifactCommand {
  runId: string;
  artifact: ArtifactRecord;
}

export interface CreateReleaseCommand {
  missionId: string;
  runId: string;
  version: string;
  milestone?: string;
  title: string;
  summary: string;
  artifactIds: string[];
}

export interface ApproveReleaseCommand {
  releaseId: string;
  reviewer?: string;
  feedback?: string;
}

export interface ShipReleaseCommand {
  releaseId: string;
}

export interface RecordHandoffCommand {
  releaseId: string;
  channel: HandoffChannel;
  target?: string;
}

export interface SubmitSteeringCommand {
  runId: string;
  text: string;
}

export type CoreCommand =
  | { type: "workspace.create"; payload: CreateWorkspaceCommand }
  | { type: "mission.create"; payload: CreateMissionCommand }
  | { type: "run.start"; payload: StartRunCommand }
  | { type: "artifact.attach"; payload: AttachArtifactCommand }
  | { type: "release.create"; payload: CreateReleaseCommand }
  | { type: "release.approve"; payload: ApproveReleaseCommand }
  | { type: "release.ship"; payload: ShipReleaseCommand }
  | { type: "handoff.record"; payload: RecordHandoffCommand }
  | { type: "steering.submit"; payload: SubmitSteeringCommand };

export type CreateReleaseResponse = {
  release: ReleaseRecord;
};
