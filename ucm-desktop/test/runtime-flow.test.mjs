import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as runtimeState from "../dist-electron/main/runtime-state-fixture.js";
import * as runtimeMutations from "../dist-electron/main/runtime-mutations.js";
import * as runtimeConductor from "../dist-electron/main/runtime-conductor.js";
import * as runtimeExecution from "../dist-electron/main/runtime-execution.js";
import * as runtimePolicy from "../dist-electron/main/runtime-policy.js";
import * as runtimeHelpers from "../dist-electron/main/runtime-run-helpers.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";
import * as runtimeServiceModule from "../dist-electron/main/runtime.js";

test("release approval completes the mission", () => {
  const state = runtimeState.cloneSeed();

  const nextRun = runtimeMutations.generateReleaseRevisionInState(state, {
    runId: "r-1",
    releaseId: "del-1",
    summary: "Prepared a fresh approval packet from the latest artifacts.",
  });

  assert.ok(nextRun);
  const release = nextRun.releases[0];
  const approved = runtimeMutations.approveReleaseRevisionInState(state, {
    runId: "r-1",
    releaseRevisionId: release.latestRevisionId,
  });

  assert.ok(approved);
  runtimeExecution.updateMissionStatusInState(
    state,
    approved.missionId,
    "completed",
  );

  const approvedRelease = approved.run.releases[0];
  const latestRevision = approvedRelease.revisions.find(
    (revision) => revision.id === approvedRelease.latestRevisionId,
  );
  const mission = state.missions.find((item) => item.id === approved.missionId);

  assert.equal(latestRevision?.status, "approved");
  assert.equal(approved.run.status, "completed");
  assert.equal(mission?.status, "completed");
});

test("blocked event produces a steering packet via conductor", () => {
  const state = runtimeState.cloneSeed();
  const located = runtimeHelpers.findRun(state, "r-1");

  assert.ok(located);

  const blockedEvent = {
    id: "ev-blocked-test",
    runId: "r-1",
    agentId: "a-builder-2",
    kind: "blocked",
    summary: "Builder is blocked on missing fixture context.",
    createdAtLabel: "just now",
    metadata: {
      requestedInput: "fixture_path",
    },
  };

  const decision = runtimeConductor.decideFromContext({
    run: located.run,
    event: blockedEvent,
    latestArtifactType: located.run.artifacts.at(-1)?.type,
    hasRelease: located.run.releases.length > 0,
  });

  runtimeConductor.applyConductorDecision(state, located.run, decision);

  const latestHandoff = located.run.handoffs.at(-1);
  const latestEvent = (state.runEventsByRunId["r-1"] ?? []).at(-1);

  assert.equal(decision.decision, "prepare_revision_and_request_steering");
  assert.equal(located.run.status, "blocked");
  assert.equal(latestHandoff?.status, "active");
  assert.equal(latestEvent?.kind, "steering_requested");
});

test("completed agent run resolves active steering and emits an artifact", () => {
  const state = runtimeState.cloneSeed();

  runtimeMutations.submitSteeringInState(state, {
    runId: "r-1",
    text: "Use the fallback fixture path from checkout fixtures.",
  });

  const completed = runtimeExecution.completeAgentRunInState(state, {
    missionId: "m-1",
    runId: "r-1",
    agentId: "a-builder-2",
    summary: "Builder resumed with the supplied fixture path and produced a patch.",
    source: "mock",
    outcome: "completed",
  });

  assert.ok(completed);

  const latestArtifact = completed.run.artifacts.at(-1);
  const steeringEvents = (state.runEventsByRunId["r-1"] ?? []).filter(
    (event) => event.kind === "steering_submitted",
  );
  const latestRunEvent = (state.runEventsByRunId["r-1"] ?? []).at(-1);

  assert.equal(latestArtifact?.type, "diff");
  assert.equal(latestRunEvent?.kind, "artifact_created");
  assert.equal(steeringEvents.at(-1)?.metadata?.status, "resolved");
});

test("execution handoff can be driven through an injected execution controller", () => {
  const state = runtimeState.cloneSeed();
  const calls = [];

  state.agentsByMissionId["m-1"] = state.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-1" ? { ...agent, status: "running" } : agent,
  );

  const fakeExecution = {
    spawnAgentRun(input) {
      calls.push({
        runId: input.runId,
        agentId: input.agent.id,
        objective: input.objective,
        steeringContext: input.steeringContext,
      });
    },
    writeTerminalSession() {
      return false;
    },
    resizeTerminalSession() {
      return false;
    },
    killTerminalSession() {},
  };

  runtimeExecution.maybeStartAgentExecutionInState({
    state,
    missionId: "m-1",
    runId: "r-1",
    agentId: "a-builder-1",
    executionService: fakeExecution,
    callbacks: {
      onSessionStart() {},
      onTerminalData() {},
      onComplete() {},
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, "a-builder-1");
  assert.match(calls[0].objective, /Patch checkout auth regression/);
});

test("provider queue gate defers spawn and records a queued event", () => {
  const state = runtimeState.cloneSeed();
  state.agentsByMissionId["m-1"] = state.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-1" ? { ...agent, status: "running" } : agent,
  );
  state.missionBudgetById["m-1"].standard = {
    limit: 0,
    used: 0,
  };

  runtimeExecution.maybeStartAgentExecutionInState({
    state,
    missionId: "m-1",
    runId: "r-1",
    agentId: "a-builder-1",
    executionService: {
      spawnAgentRun() {
        return false;
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
    callbacks: {
      onSessionStart() {},
      onTerminalData() {},
      onComplete() {},
    },
  });

  const latestEvent = (state.runEventsByRunId["r-1"] ?? []).at(-1);
  const latestLifecycle = (state.lifecycleEventsByMissionId["m-1"] ?? []).at(-1);
  const builder = state.agentsByMissionId["m-1"].find((agent) => agent.id === "a-builder-1");
  const run = state.runsByMissionId["m-1"].find((item) => item.id === "r-1");

  assert.equal(builder?.status, "queued");
  assert.equal(run?.status, "queued");
  assert.equal(latestEvent?.kind, "agent_status_changed");
  assert.equal(latestEvent?.metadata?.source, "provider_queue");
  assert.equal(latestLifecycle?.kind, "queued");
});

test("runtime service autopilot step can run with injected store and execution controller", () => {
  const changeReasons = [];
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed, (reason) => {
    changeReasons.push(reason);
  });
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-1"
      ? { ...agent, status: "idle" }
      : agent.id === "a-verifier"
        ? { ...agent, status: "idle" }
        : agent,
  );
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-autopilot-diff",
      type: "diff",
      title: "Fresh autopilot diff",
      preview: "Latest artifact is a diff so verification can branch.",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-artifact-autopilot",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "A fresh diff artifact is ready for the next execution pass.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);
  const executionCalls = [];
  const fakeExecution = {
    spawnAgentRun(input) {
      executionCalls.push({
        runId: input.runId,
        agentId: input.agent.id,
      });
    },
    writeTerminalSession() {
      return false;
    },
    resizeTerminalSession() {
      return false;
    },
    killTerminalSession() {},
  };

  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: fakeExecution,
    onStateChange(reason) {
      changeReasons.push(reason);
    },
  });

  const result = runtime.autopilotStep();
  const state = store.read();
  const activeRun = runtime.getActiveRun();
  const latestDecision = activeRun?.decisions.at(-1);
  const latestHandoff = activeRun?.handoffs.at(-1);

  assert.equal(result.decision, "prepare_revision");
  assert.equal(result.eventKind, "artifact_created");
  assert.ok(activeRun);
  assert.ok(activeRun.releases[0].revisions.length >= 3);
  assert.equal(latestDecision?.category, "orchestration");
  assert.ok(changeReasons.includes("state_changed"));
  assert.equal(state.autopilotHandledEventIdsByRunId["r-1"]?.length, 1);
  assert.ok(executionCalls.length >= 1);
  assert.equal(executionCalls[0].agentId, "a-verifier");
  assert.notEqual(executionCalls[0].runId, "r-1");
});

test("runtime service autopilot burst drains chained events in one cycle", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-1"
      ? { ...agent, status: "idle" }
      : agent.id === "a-verifier"
        ? { ...agent, status: "idle" }
        : agent,
  );
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-burst-diff",
      type: "diff",
      title: "Burst diff",
      preview: "Latest artifact is a diff so verification can branch.",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-artifact-burst",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "A diff artifact arrived and should wake the next agent.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push(input.agent.id);
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  const burst = runtime.autopilotBurst({ maxSteps: 4 });
  const state = store.read();

  assert.ok(burst.appliedCount >= 2);
  assert.equal(burst.steps[0].eventKind, "artifact_created");
  assert.equal(burst.steps[1].eventKind, "agent_status_changed");
  assert.ok((state.autopilotHandledEventIdsByRunId["r-1"]?.length ?? 0) >= 2);
  assert.ok(executionCalls.includes("a-verifier"));
  assert.ok(!executionCalls.includes("a-builder-1"));
});

test("runtime service autopilot can select pending work from a non-active run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();

  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.runsByMissionId["m-2"] = [
    {
      id: "r-2",
      missionId: "m-2",
      agentId: "a-release-builder",
      title: "Prepare release packet",
      status: "running",
      summary: "Release prep run is waiting to be picked up.",
      activeSurface: "artifacts",
      terminalPreview: [],
      timeline: [],
      decisions: [],
      artifacts: [
        {
          id: "art-release-1",
          type: "report",
          title: "Release readiness report",
          preview: "Release evidence bundle is ready.",
        },
      ],
      runEvents: [],
      releases: [
        {
          id: "del-release-1",
          kind: "review_packet",
          title: "Release review packet",
          latestRevisionId: "del-release-1-r1",
          revisions: [
            {
              id: "del-release-1-r1",
              revision: 1,
              summary: "Initial release packet.",
              createdAtLabel: "just now",
              basedOnArtifactIds: ["art-release-1"],
              status: "active",
            },
          ],
        },
      ],
      handoffs: [],
    },
  ];
  seededState.runEventsByRunId["r-2"] = [
    {
      id: "ev-release-review",
      runId: "r-2",
      agentId: "a-release-builder",
      kind: "needs_review",
      summary: "Release packet is ready for review.",
      createdAtLabel: "just now",
    },
  ];

  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun() {},
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  const result = runtime.autopilotStep();
  const state = store.read();
  const activeRun = runtime.getActiveRun();

  assert.equal(result.eventKind, "needs_review");
  assert.equal(result.decision, "prepare_revision_and_request_review");
  assert.equal(state.activeMissionId, "m-2");
  assert.equal(state.activeRunId, "r-2");
  assert.equal(activeRun?.id, "r-2");
  assert.equal(activeRun?.status, "needs_review");
});

test("runtime service resumes a queued run when the provider window becomes free", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.runsByMissionId["m-1"][0] = {
    ...seededState.runsByMissionId["m-1"][0],
    status: "queued",
    providerPreference: "codex",
  };
  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-2" ? { ...agent, status: "queued" } : agent,
  );
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({
          runId: input.runId,
          agentId: input.agent.id,
          provider: input.providerPreference,
        });
        return true;
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.tickAutopilot();
  const state = store.read();
  const resumedRun = state.runsByMissionId["m-1"].find((run) => run.id === "r-1");
  const resumedAgent = state.agentsByMissionId["m-1"].find((agent) => agent.id === "a-builder-2");
  const latestEvent = (state.runEventsByRunId["r-1"] ?? []).at(-1);

  assert.equal(resumedRun?.status, "running");
  assert.equal(resumedAgent?.status, "running");
  assert.equal(executionCalls.length, 1);
  assert.equal(executionCalls[0].provider, "codex");
  assert.equal(latestEvent?.metadata?.source, "provider_resume");
});

test("artifact-created verification work branches into a dedicated follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-1"
      ? { ...agent, status: "running" }
      : agent.id === "a-verifier"
        ? { ...agent, status: "idle" }
        : agent,
  );
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-followup-diff",
      type: "diff",
      title: "Fresh implementation diff",
      preview: "checkout/session.ts updated for dedicated verification pass",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-artifact-verifier-run",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "Implementation emitted a fresh diff that needs a dedicated verification pass.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({ runId: input.runId, agentId: input.agent.id });
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const followupRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.agentId === "a-verifier" && run.id !== "r-1",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].status, "running");
  assert.match(followupRuns[0].title, /Verify/);
  assert.equal(followupRuns[0].origin?.schedulerRuleId, "verification_from_diff_artifact");
  assert.equal(followupRuns[0].origin?.spawnMode, "execute");
  assert.equal(followupRuns[0].origin?.budgetClass, "standard");
  assert.equal(state.missionBudgetById["m-1"].standard.used, 1);
  assert.ok(executionCalls.some((call) => call.runId === followupRuns[0].id && call.agentId === "a-verifier"));
});

test("blocked work branches into a dedicated research follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-researcher" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-blocked-research-run",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "blocked",
      summary: "Builder is blocked on missing external context.",
      createdAtLabel: "just now",
      metadata: {
        requestedInput: "external_context",
      },
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({ runId: input.runId, agentId: input.agent.id });
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const followupRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.agentId === "a-researcher" && run.id !== "r-1",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].status, "running");
  assert.match(followupRuns[0].title, /Research/);
  assert.equal(followupRuns[0].origin?.schedulerRuleId, "research_from_blocker_context");
  assert.equal(followupRuns[0].origin?.spawnMode, "execute");
  assert.equal(followupRuns[0].origin?.budgetClass, "light");
  assert.equal(state.missionBudgetById["m-1"].light.used, 2);
  assert.ok(
    executionCalls.some(
      (call) => call.runId === followupRuns[0].id && call.agentId === "a-researcher",
    ),
  );
});

test("review-ready work branches into a dedicated review follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-review-run",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "needs_review",
      summary: "Implementation packet is review-ready.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({ runId: input.runId, agentId: input.agent.id });
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const followupRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.agentId === "a-verifier" && run.id !== "r-1",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].status, "needs_review");
  assert.match(followupRuns[0].title, /Review/);
  assert.equal(followupRuns[0].origin?.schedulerRuleId, "review_from_review_ready_event");
  assert.equal(followupRuns[0].origin?.spawnMode, "queue_only");
  assert.equal(followupRuns[0].origin?.budgetClass, "light");
  assert.equal(state.missionBudgetById["m-1"].light.used, 2);
  assert.equal(executionCalls.length, 0);
});

test("scheduler respects maxOpenRuns for verification follow-up runs", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-existing-verify",
    missionId: "m-1",
    agentId: "a-verifier",
    title: "Verify Existing checkout regression",
    status: "running",
    summary: "Existing verification run already open.",
    activeSurface: "artifacts",
    terminalPreview: [],
    origin: {
      parentRunId: "r-1",
      sourceEventId: "ev-old",
      sourceEventKind: "artifact_created",
      schedulerRuleId: "verification_from_diff_artifact",
      spawnMode: "execute",
      budgetClass: "standard",
    },
    timeline: [],
    decisions: [],
    artifacts: [],
    runEvents: [],
    releases: [],
    handoffs: [],
  });
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-new-diff-limit",
      type: "diff",
      title: "Another diff",
      preview: "fresh diff that would normally trigger verifier",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-artifact-limit",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "Another diff is ready.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({ runId: input.runId, agentId: input.agent.id });
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const verifyRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.origin?.schedulerRuleId === "verification_from_diff_artifact",
  );

  assert.equal(verifyRuns.length, 1);
  assert.ok(
    executionCalls.every((call) => call.runId !== "r-existing-verify"),
  );
});

test("scheduler respects exclusiveWith by blocking verification when a review run is open", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-existing-review",
    missionId: "m-1",
    agentId: "a-verifier",
    title: "Review Checkout auth merge handoff",
    status: "needs_review",
    summary: "Existing review run is open.",
    activeSurface: "artifacts",
    terminalPreview: [],
    origin: {
      parentRunId: "r-1",
      sourceEventId: "ev-review-open",
      sourceEventKind: "needs_review",
      schedulerRuleId: "review_from_review_ready_event",
      spawnMode: "queue_only",
      budgetClass: "light",
    },
    timeline: [],
    decisions: [],
    artifacts: [],
    runEvents: [],
    releases: [],
    handoffs: [],
  });
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-exclusive-diff",
      type: "diff",
      title: "Diff while review open",
      preview: "verification should be blocked by exclusive rule",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-artifact-exclusive",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "Diff arrived while review run is still open.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun() {},
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const verifyRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.origin?.schedulerRuleId === "verification_from_diff_artifact",
  );

  assert.equal(verifyRuns.length, 0);
});

test("scheduler blocks follow-up creation when mission budget bucket is exhausted", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.missionBudgetById["m-1"].standard = {
    limit: 1,
    used: 1,
  };
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"][0].artifacts = [
    ...seededState.runsByMissionId["m-1"][0].artifacts,
    {
      id: "art-budget-blocked-diff",
      type: "diff",
      title: "Budget-blocked diff",
      preview: "standard budget should prevent a new verification branch",
    },
  ];
  seededState.runEventsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []),
    {
      id: "ev-budget-blocked",
      runId: "r-1",
      agentId: "a-builder-2",
      kind: "artifact_created",
      summary: "A diff arrived but the standard budget bucket is exhausted.",
      createdAtLabel: "just now",
    },
  ];
  store.write(seededState);

  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({ runId: input.runId, agentId: input.agent.id });
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  runtime.autopilotStep();
  const state = store.read();
  const verifyRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.origin?.schedulerRuleId === "verification_from_diff_artifact",
  );

  assert.equal(verifyRuns.length, 0);
  assert.equal(state.missionBudgetById["m-1"].standard.used, 1);
  assert.ok(
    executionCalls.every((call) => call.agentId !== "a-verifier"),
  );
});

test("runtime service can add a real workspace path and switch into an empty state", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const runtime = new runtimeServiceModule.RuntimeService({ store });
  const tempWorkspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), "ucm-desktop-workspace-"),
  );

  const workspaces = runtime.addWorkspace({ rootPath: tempWorkspacePath });
  const addedWorkspace = workspaces.find(
    (workspace) => workspace.rootPath === tempWorkspacePath,
  );

  assert.ok(addedWorkspace);
  assert.equal(addedWorkspace.active, true);
  assert.equal(runtime.getActiveMission(), null);
  assert.equal(runtime.getActiveRun(), null);
  assert.deepEqual(runtime.listMissions(), []);
  assert.deepEqual(runtime.listRunsForActiveMission(), []);
});

test("creating a mission with a workspace command immediately starts execution", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({
          runId: input.runId,
          agentId: input.agent.id,
          workspaceCommand: input.workspaceCommand,
          workspacePath: input.workspacePath,
        });
        return true;
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  const workspaceId = runtime.listWorkspaces()[0].id;
  const mission = runtime.createMission({
    workspaceId,
    title: "Run local build",
    goal: "Execute a real workspace command from the desktop app.",
    command: "npm test",
  });

  assert.ok(mission.id);
  assert.equal(executionCalls.length, 1);
  assert.equal(executionCalls[0].workspaceCommand, "npm test");
});

test("setting the active mission also selects its workspace and run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const runtime = new runtimeServiceModule.RuntimeService({ store });

  const mission = runtime.createMission({
    workspaceId: runtime.listWorkspaces()[0].id,
    title: "Plan release review",
    goal: "Collect the remaining release checks.",
  });

  const detail = runtime.setActiveMission({ missionId: mission.id });
  assert.ok(detail);
  assert.equal(detail.id, mission.id);

  const activeMission = runtime.getActiveMission();
  const activeRun = runtime.getActiveRun();
  const activeWorkspace = runtime.listWorkspaces().find((workspace) => workspace.active);

  assert.equal(activeMission?.id, mission.id);
  assert.equal(activeRun?.missionId, mission.id);
  assert.equal(activeWorkspace?.id, runtime.listWorkspaces()[0].id);
});

test("retrying a workspace command run starts a fresh execution record", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const executionCalls = [];
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({
          runId: input.runId,
          agentId: input.agent.id,
          workspaceCommand: input.workspaceCommand,
        });
        return true;
      },
      writeTerminalSession() {
        return false;
      },
      resizeTerminalSession() {
        return false;
      },
      killTerminalSession() {},
    },
  });

  const workspaceId = runtime.listWorkspaces()[0].id;
  runtime.createMission({
    workspaceId,
    title: "Retry local build",
    goal: "Run the same local command twice from the desktop app.",
    command: "npm test",
  });

  const initialRun = runtime.getActiveRun();
  assert.ok(initialRun);

  const retried = runtime.retryRun({ runId: initialRun.id });
  assert.ok(retried);
  assert.notEqual(retried.id, initialRun.id);
  assert.equal(retried.workspaceCommand, "npm test");
  assert.equal(retried.origin?.schedulerRuleId, "manual_retry");
  assert.equal(executionCalls.length, 2);
  assert.equal(executionCalls[1].workspaceCommand, "npm test");
});
