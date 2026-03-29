import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as runtimeState from "../dist-electron/main/runtime-state-fixture.js";
import * as runtimeMutations from "../dist-electron/main/runtime-mutations.js";
import * as runtimeConductor from "../dist-electron/main/runtime-conductor.js";
import * as runtimeExecution from "../dist-electron/main/runtime-execution.js";
import * as runtimeArtifacts from "../dist-electron/main/runtime-artifacts.js";
import * as runtimePolicy from "../dist-electron/main/runtime-policy.js";
import * as runtimeHelpers from "../dist-electron/main/runtime-run-helpers.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";
import * as runtimeServiceModule from "../dist-electron/main/runtime.js";

function createNoopExecutionService(overrides = {}) {
  return {
    spawnAgentRun() {
      return true;
    },
    writeTerminalSession() {
      return false;
    },
    resizeTerminalSession() {
      return false;
    },
    killTerminalSession() {},
    ...overrides,
  };
}

test("release approval completes the mission", () => {
  const state = runtimeState.cloneSeed();

  const nextRun = runtimeMutations.generateDeliverableRevisionInState(state, {
    runId: "r-1",
    deliverableId: "del-1",
    summary: "Prepared a fresh approval packet from the latest artifacts.",
  });

  assert.ok(nextRun);
  const deliverable = nextRun.deliverables.find((d) => d.id === "del-1");
  const approved = runtimeMutations.approveDeliverableRevisionInState(state, {
    runId: "r-1",
    deliverableRevisionId: deliverable.latestRevisionId,
  });

  assert.ok(approved);
  runtimeExecution.updateMissionStatusInState(
    state,
    approved.missionId,
    "completed",
  );

  const approvedDeliverable = approved.run.deliverables.find((d) => d.id === "del-1");
  const latestRevision = approvedDeliverable.revisions.find(
    (revision) => revision.id === approvedDeliverable.latestRevisionId,
  );
  const mission = state.missions.find((item) => item.id === approved.missionId);
  const deliverableArtifacts = approved.run.artifacts.filter(
    (artifact) => artifact.contractKind === "deliverable_revision",
  );

  assert.equal(latestRevision?.status, "approved");
  assert.equal(approved.run.status, "completed");
  assert.equal(mission?.status, "completed");
  assert.ok(deliverableArtifacts.some((artifact) => artifact.payload?.status === "approved"));
});

test("handoffDeliverableInState emits an explicit handoff artifact", () => {
  const state = runtimeState.cloneSeed();
  const nextRun = runtimeMutations.generateDeliverableRevisionInState(state, {
    runId: "r-1",
    deliverableId: "del-1",
    summary: "Prepared a fresh approval packet from the latest artifacts.",
  });
  assert.ok(nextRun);

  const handedOff = runtimeMutations.handoffDeliverableInState(state, {
    runId: "r-1",
    deliverableRevisionId: nextRun.deliverables[0].latestRevisionId,
    channel: "inbox",
    target: "human reviewer",
  });

  assert.ok(handedOff);
  assert.ok(
    handedOff.artifacts.some((artifact) => artifact.contractKind === "handoff_record"),
  );
});

test("approval keeps the mission completed and branches into a dedicated release follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  const sourceRun = seededState.runsByMissionId["m-1"][0];
  sourceRun.deliverables = [
    {
      id: "del-release-ready",
      kind: "review_packet",
      title: "Release-ready review packet",
      latestRevisionId: "del-release-ready-r1",
      revisions: [
        {
          id: "del-release-ready-r1",
          revision: 1,
          summary: "Approved review packet for release packaging.",
          createdAtLabel: "just now",
          basedOnArtifactIds: [
            "art-release-review",
            "art-release-evidence",
            "art-release-rollback",
          ],
          status: "active",
        },
      ],
    },
  ];
  sourceRun.handoffs = [
    {
      id: "handoff-release-ready",
      deliverableRevisionId: "del-release-ready-r1",
      channel: "inbox",
      target: "human reviewer",
      createdAtLabel: "just now",
      status: "active",
    },
  ];
  sourceRun.artifacts = [
    runtimeArtifacts.createArtifactRecord({
      id: "art-release-review",
      type: "report",
      title: "Review packet artifact",
      preview: "Review packet is ready for release packaging.",
      contractKind: "review_packet",
      payload: {
        summary: "Approved review packet.",
        selectedApproach: "Keep the checkout patch narrow and rollback-safe.",
        artifactIds: ["art-release-review", "art-release-evidence", "art-release-rollback"],
        evidencePackIds: ["art-release-evidence"],
        functionalStatus: "pass",
        visualStatus: "not_applicable",
        bugRiskStatus: "pass",
        smokeStatus: "pass",
        surfacesReviewed: [],
        knownIssues: [],
        openRisks: [],
        requestedAction: "review",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-release-evidence",
      type: "report",
      title: "Evidence pack artifact",
      preview: "Evidence pack supports completion.",
      contractKind: "evidence_pack",
      payload: {
        id: "evp-r-1-release",
        decision: "promote_to_completion",
        checks: [
          {
            name: "verification_signal_present",
            status: "pass",
            summary: "Verification artifacts exist.",
          },
        ],
        artifactIds: ["art-release-review"],
        generatedAtLabel: "just now",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-release-rollback",
      type: "report",
      title: "Rollback plan artifact",
      preview: "Rollback plan is attached.",
      contractKind: "rollback_plan",
      payload: {
        summary: "Rollback to the previously approved checkout flow.",
        triggerConditions: ["Regression appears after release packaging."],
        rollbackSteps: ["Revert the checkout auth patch."],
        verificationSteps: ["Re-run the checkout regression suite."],
      },
    }),
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

  runtime.approveDeliverableRevision({
    runId: "r-1",
    deliverableRevisionId: "del-release-ready-r1",
  });
  const result = runtime.autopilotStep();
  const state = store.read();
  const mission = state.missions.find((item) => item.id === "m-1");
  const releaseRuns = (state.runsByMissionId["m-1"] ?? []).filter(
    (run) => run.origin?.schedulerRuleId === "release_from_approved_revision",
  );

  assert.equal(result.eventKind, "completed");
  assert.equal(result.decision, "observe");
  assert.equal(mission?.status, "completed");
  assert.equal(state.runsByMissionId["m-1"][0].status, "completed");
  assert.equal(releaseRuns.length, 1);
  assert.equal(releaseRuns[0].roleContractId, "release_agent");
  assert.equal(releaseRuns[0].deliverables[0].kind, "release_brief");
  assert.ok(
    executionCalls.some(
      (call) => call.runId === releaseRuns[0].id && call.agentId === "a-verifier",
    ),
  );
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
    hasDeliverable: located.run.deliverables.length > 0,
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
    generatedPatch: `diff --git a/src/checkout/session.ts b/src/checkout/session.ts
@@
-return oldFixturePath;
+return resolveCheckoutFixture();`,
  });

  assert.ok(completed);

  const patchArtifact = completed.run.artifacts.find(
    (artifact) => artifact.contractKind === "patch_set",
  );
  const traceArtifact = completed.run.artifacts.find(
    (artifact) => artifact.contractKind === "run_trace",
  );
  const steeringEvents = (state.runEventsByRunId["r-1"] ?? []).filter(
    (event) => event.kind === "steering_submitted",
  );
  const latestRunEvent = (state.runEventsByRunId["r-1"] ?? []).at(-1);

  assert.equal(patchArtifact?.type, "diff");
  assert.equal(traceArtifact?.type, "report");
  assert.equal(completed.run.status, "completed");
  assert.equal(latestRunEvent?.kind, "artifact_created");
  assert.equal(steeringEvents.at(-1)?.metadata?.status, "resolved");
});

test("learning-agent completion emits a structured improvement proposal and execution stats", () => {
  const state = runtimeState.cloneSeed();

  state.agentsByMissionId["m-1"] = state.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-researcher" ? { ...agent, status: "running" } : agent,
  );
  state.runsByMissionId["m-1"][0].executionStats = {
    provider: "codex",
    estimatedPromptTokens: 320,
    promptChars: 1280,
    outputChars: 640,
    latencyMs: 2400,
    retryCount: 1,
    blockerCount: 1,
    steeringCount: 1,
    localityScore: 0.42,
    usedTerminalSession: true,
  };
  state.runsByMissionId["m-1"].push({
    id: "r-build-recent-1",
    missionId: "m-1",
    agentId: "a-builder-1",
    roleContractId: "builder_agent",
    title: "Replay checkout auth fallback",
    status: "completed",
    summary: "Recent implementation run completed with high prompt replay overhead.",
    budgetClass: "standard",
    providerPreference: "codex",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [],
    decisions: [],
    artifacts: [],
    runEvents: [],
    deliverables: [],
    handoffs: [],
    executionStats: {
      provider: "codex",
      estimatedPromptTokens: 260,
      promptChars: 1040,
      outputChars: 520,
      latencyMs: 2100,
      retryCount: 0,
      blockerCount: 0,
      steeringCount: 1,
      localityScore: 0.48,
      usedTerminalSession: true,
    },
  });
  state.runEventsByRunId["r-build-recent-1"] = [];
  state.runsByMissionId["m-1"].push({
    id: "r-learning-1",
    missionId: "m-1",
    agentId: "a-researcher",
    roleContractId: "learning_agent",
    title: "Learn from checkout auth incidents",
    status: "running",
    summary: "Researcher is converting ops evidence into a self-improvement proposal.",
    budgetClass: "light",
    providerPreference: "gemini",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [
      {
        id: "tl-learning-start",
        kind: "started",
        summary: "Learning run started.",
        timestampLabel: "just now",
      },
    ],
    decisions: [],
    artifacts: [
      runtimeArtifacts.createArtifactRecord({
        id: "art-learning-incident",
        type: "report",
        title: "Incident record",
        preview: "Retry spikes were observed after rollout.",
        contractKind: "incident_record",
        payload: {
          summary: "Retry spikes were observed after rollout.",
        },
      }),
    ],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  });
  state.runEventsByRunId["r-learning-1"] = [];

  const completed = runtimeExecution.completeAgentRunInState(state, {
    missionId: "m-1",
    runId: "r-learning-1",
    agentId: "a-researcher",
    summary: "Learning pass generated a structured proposal.",
    source: "mock",
    outcome: "completed",
    stdout: '{"title":"Cache-local handoff","summary":"Use artifact-addressed handoff for implementation reruns.","scope":"workflow","hypothesis":"Artifact-addressed handoff reduces repeated prompt assembly.","expectedImpact":"Lower token cost and fewer repeated blockers.","requiredEvals":["Replay recent implementation failures."]}\nStatus: completed',
    executionStats: {
      provider: "gemini",
      estimatedPromptTokens: 128,
      promptChars: 512,
      outputChars: 240,
      latencyMs: 1500,
      retryCount: 0,
      blockerCount: 0,
      steeringCount: 0,
      localityScore: 0.91,
      usedTerminalSession: false,
    },
  });

  assert.ok(completed);
  const proposalArtifact = completed.run.artifacts.find(
    (artifact) => artifact.contractKind === "improvement_proposal",
  );
  const replayArtifact = completed.run.artifacts.find(
    (artifact) => artifact.contractKind === "historical_replay_result",
  );

  assert.equal(proposalArtifact?.type, "report");
  assert.equal(proposalArtifact?.payload?.scope, "workflow");
  assert.match(proposalArtifact?.payload?.hypothesis ?? "", /artifact-addressed handoff/i);
  assert.equal(replayArtifact?.type, "report");
  assert.equal(replayArtifact?.payload?.templateId, "artifact_refs_with_delta");
  assert.deepEqual(replayArtifact?.payload?.baselineRunIds, ["r-1", "r-build-recent-1"]);
  assert.ok(
    replayArtifact?.payload?.experiment?.projectedAvgEstimatedPromptTokens <
      replayArtifact?.payload?.baseline?.avgEstimatedPromptTokens,
  );
  assert.equal(completed.run.executionStats?.estimatedPromptTokens, 128);
  assert.equal(completed.run.executionStats?.latencyMs, 1500);
});

test("builder completion still triggers verification follow-up after trace artifacts are appended", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.runsByMissionId["m-1"][0].status = "running";
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-builder-2"
      ? { ...agent, status: "running" }
      : agent.id === "a-verifier"
        ? { ...agent, status: "idle" }
        : agent,
  );
  runtimeExecution.completeAgentRunInState(seededState, {
    missionId: "m-1",
    runId: "r-1",
    agentId: "a-builder-2",
    summary: "Builder completed the auth patch and captured a real diff.",
    source: "mock",
    outcome: "completed",
    generatedPatch: `diff --git a/src/checkout/session.ts b/src/checkout/session.ts
@@
-return oldFixturePath;
+return resolveCheckoutFixture();`,
  });
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
  assert.equal(followupRuns[0].origin?.schedulerRuleId, "verification_from_diff_artifact");
  assert.ok(executionCalls.some((call) => call.runId === followupRuns[0].id));
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

test("local workspace execution blocks instead of entering an orphaned queue", () => {
  const state = runtimeState.cloneSeed();
  const mission = runtimeMutations.createMissionInState(state, {
    workspaceId: state.activeWorkspaceId,
    title: "Run local command",
    goal: "Exercise the local execution lane.",
    command: "npm test",
  });
  const runId = `r-${mission.id}`;
  const builderId = `a-builder-${mission.id}`;

  runtimeExecution.maybeStartAgentExecutionInState({
    state,
    missionId: mission.id,
    runId,
    agentId: builderId,
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

  const run = state.runsByMissionId[mission.id].find((item) => item.id === runId);
  const agent = state.agentsByMissionId[mission.id].find((item) => item.id === builderId);
  const latestEvent = (state.runEventsByRunId[runId] ?? []).at(-1);

  assert.equal(run?.status, "blocked");
  assert.equal(agent?.status, "blocked");
  assert.equal(latestEvent?.kind, "blocked");
  assert.equal(latestEvent?.metadata?.source, "local_lane_busy");
});

test("createMissionInState seeds planning missions with research and design agents", () => {
  const state = runtimeState.cloneSeed();
  const mission = runtimeMutations.createMissionInState(state, {
    workspaceId: state.activeWorkspaceId,
    title: "Plan shipping lane",
    goal: "Shape the next release and incident workflow.",
  });

  const agents = state.agentsByMissionId[mission.id] ?? [];
  const agentIds = new Set(agents.map((agent) => agent.id));
  const missionDetail = state.missionDetailsById[mission.id];

  assert.ok(agentIds.has(`a-researcher-${mission.id}`));
  assert.ok(agentIds.has(`a-architect-${mission.id}`));
  assert.ok(missionDetail.agentIds.includes(`a-researcher-${mission.id}`));
  assert.ok(missionDetail.agentIds.includes(`a-architect-${mission.id}`));
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
  assert.ok(activeRun.deliverables.find((d) => d.id === "del-1").revisions.length >= 3);
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
      roleContractId: "release_agent",
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
      deliverables: [
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

test("shell snapshot lists gemini alongside existing provider windows", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: createNoopExecutionService(),
  });

  const snapshot = runtime.getShellSnapshot();
  const providers = snapshot.providerWindows.map((item) => item.provider);

  assert.deepEqual(providers, ["claude", "codex", "gemini"]);
  assert.equal(snapshot.providerWindows.find((item) => item.provider === "gemini")?.status, "ready");
});

test("hydrateRunDetail derives a review-ready evidence pack from artifacts and revisions", () => {
  const state = runtimeState.cloneSeed();
  const run = state.runsByMissionId["m-1"][0];

  run.artifacts = [
    ...run.artifacts,
    {
      id: "art-evidence-diff",
      type: "diff",
      title: "Checkout auth patch",
      preview: "checkout/session.ts patched for review",
    },
    {
      id: "art-evidence-test",
      type: "test_result",
      title: "Regression verification",
      preview: "Regression suite is green.",
    },
  ];

  const hydrated = runtimeHelpers.hydrateRunDetail(state, run);
  const evidence = hydrated.evidencePacks?.[0];

  assert.ok(evidence);
  assert.equal(evidence?.decision, "promote_to_review");
  assert.equal(
    evidence?.checks.find((check) => check.name === "verification_signal_present")?.status,
    "pass",
  );
});

test("hydrateRunDetail treats explicit review packet artifacts as review evidence", () => {
  const state = runtimeState.cloneSeed();
  const run = state.runsByMissionId["m-1"][0];

  run.deliverables = [];
  run.artifacts = [
    ...run.artifacts,
    runtimeArtifacts.createArtifactRecord({
      id: "art-explicit-review-packet",
      type: "report",
      title: "Explicit review packet",
      preview: "Review packet was captured as an artifact.",
      contractKind: "review_packet",
      payload: {
        summary: "Ready for review.",
        selectedApproach: "Patch the checkout fallback flow.",
        artifactIds: ["art-explicit-review-packet"],
        evidencePackIds: ["evp-r-1-latest"],
        functionalStatus: "pass",
        visualStatus: "not_applicable",
        bugRiskStatus: "pass",
        smokeStatus: "pass",
        surfacesReviewed: [],
        knownIssues: [],
        openRisks: [],
        requestedAction: "review",
      },
    }),
  ];

  const hydrated = runtimeHelpers.hydrateRunDetail(state, run);
  const evidence = hydrated.evidencePacks?.[0];

  assert.ok(evidence);
  assert.equal(
    evidence?.checks.find((check) => check.name === "review_packet_present")?.status,
    "pass",
  );
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
  assert.equal(
    followupRuns[0].artifacts.find((artifact) => artifact.contractKind === "patch_set")
      ?.payloadValidation?.valid,
    true,
  );
  assert.deepEqual(
    followupRuns[0].deliverables[0].revisions[0].basedOnArtifactIds,
    followupRuns[0].artifacts.map((artifact) => artifact.id),
  );
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

test("mission bootstrap branches into a dedicated spec follow-up run without waking a phantom builder", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
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

  const mission = runtime.createMission({
    workspaceId: runtime.listWorkspaces()[0].id,
    title: "Plan release review",
    goal: "Collect the remaining release checks.",
  });

  runtime.autopilotStep();
  const state = store.read();
  const followupRuns = (state.runsByMissionId[mission.id] ?? []).filter(
    (run) => run.origin?.schedulerRuleId === "spec_from_conductor_bootstrap",
  );
  const builder = (state.agentsByMissionId[mission.id] ?? []).find(
    (agent) => agent.id === `a-builder-${mission.id}`,
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].roleContractId, "spec_agent");
  assert.equal(followupRuns[0].status, "running");
  assert.equal(builder?.status, "idle");
  assert.ok(
    executionCalls.some(
      (call) =>
        call.runId === followupRuns[0].id && call.agentId === `a-architect-${mission.id}`,
    ),
  );
});

test("completed research branches into a dedicated architecture follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.activeMissionId = "m-1";
  seededState.activeRunId = "r-research-complete";
  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-architect" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-research-complete",
    missionId: "m-1",
    agentId: "a-researcher",
    roleContractId: "research_agent",
    title: "Research checkout rollback paths",
    status: "completed",
    summary: "Research gathered rollback constraints and prior incidents.",
    budgetClass: "light",
    providerPreference: "gemini",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [
      {
        id: "tl-research-start",
        kind: "started",
        summary: "Research run started.",
        timestampLabel: "2m ago",
      },
      {
        id: "tl-research-complete",
        kind: "completed",
        summary: "Research run completed.",
        timestampLabel: "just now",
      },
    ],
    decisions: [
      {
        id: "d-research-1",
        category: "planning",
        summary: "Capture rollback-sensitive constraints before architecture work resumes.",
        rationale: "Architecture depends on the latest risk framing.",
      },
    ],
    artifacts: [
      runtimeArtifacts.createArtifactRecord({
        id: "art-research-spec",
        type: "report",
        title: "Inherited spec brief",
        preview: "Checkout rollback scope.",
        contractKind: "spec_brief",
        payload: {
          title: "Checkout rollback",
          problem: "Restore checkout stability.",
          targetUsers: [],
          jobsToBeDone: [],
          goals: ["Restore checkout stability."],
          nonGoals: [],
          constraints: [],
          openQuestions: [],
        },
      }),
      runtimeArtifacts.createArtifactRecord({
        id: "art-research-dossier",
        type: "report",
        title: "Research dossier",
        preview: "Rollback constraints are attached.",
        contractKind: "research_dossier",
        payload: {
          question: "What rollback path keeps auth intact?",
          findings: ["Reuse the narrow recovery path."],
          sourceIds: [],
          confidence: "observed",
          updatedAt: "just now",
        },
      }),
      runtimeArtifacts.createArtifactRecord({
        id: "art-risk-register-complete",
        type: "report",
        title: "Risk register",
        preview: "Auth coupling risk is attached.",
        contractKind: "risk_register",
        payload: {
          risks: [
            {
              id: "risk-auth-coupling",
              summary: "Auth helper coupling remains the main design risk.",
              severity: "high",
            },
          ],
        },
      }),
    ],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  });
  seededState.runEventsByRunId["r-research-complete"] = [
    {
      id: "ev-research-complete",
      runId: "r-research-complete",
      agentId: "a-researcher",
      kind: "completed",
      summary: "Research pass completed and is ready for architecture.",
      createdAtLabel: "just now",
      metadata: {
        source: "mock",
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
    (run) => run.origin?.schedulerRuleId === "architecture_from_research_completion",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].roleContractId, "architect_agent");
  assert.equal(followupRuns[0].status, "running");
  assert.equal(state.missionBudgetById["m-1"].heavy.used, 1);
  assert.ok(
    executionCalls.some(
      (call) => call.runId === followupRuns[0].id && call.agentId === "a-architect",
    ),
  );
});

test("completed verification branches into a dedicated security follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.activeMissionId = "m-1";
  seededState.activeRunId = "r-qa-complete";
  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-verifier" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-qa-complete",
    missionId: "m-1",
    agentId: "a-verifier",
    roleContractId: "qa_agent",
    title: "Verify checkout auth patch",
    status: "completed",
    summary: "Verification completed with enough evidence for the next gate.",
    budgetClass: "standard",
    providerPreference: "claude",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [
      {
        id: "tl-qa-start",
        kind: "started",
        summary: "QA run started.",
        timestampLabel: "2m ago",
      },
      {
        id: "tl-qa-complete",
        kind: "completed",
        summary: "QA run completed.",
        timestampLabel: "just now",
      },
    ],
    decisions: [],
    artifacts: [
      runtimeArtifacts.createArtifactRecord({
        id: "art-qa-patch",
        type: "diff",
        title: "Patch set",
        preview: "Verified checkout patch.",
        contractKind: "patch_set",
        payload: {
          runId: "r-qa-complete",
          summary: "Verified checkout patch",
          patchLength: 42,
        },
      }),
      runtimeArtifacts.createArtifactRecord({
        id: "art-qa-evidence",
        type: "report",
        title: "Evidence pack",
        preview: "Verification evidence is attached.",
        contractKind: "evidence_pack",
        payload: {
          id: "evp-r-qa-complete",
          decision: "promote_to_review",
          checks: [
            {
              name: "verification_signal_present",
              status: "pass",
              summary: "Verification artifacts exist.",
            },
          ],
          artifactIds: ["art-qa-patch"],
          generatedAtLabel: "just now",
        },
      }),
    ],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  });
  seededState.runEventsByRunId["r-qa-complete"] = [
    {
      id: "ev-qa-complete",
      runId: "r-qa-complete",
      agentId: "a-verifier",
      kind: "completed",
      summary: "Verification is complete.",
      createdAtLabel: "just now",
      metadata: {
        source: "mock",
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
    (run) => run.origin?.schedulerRuleId === "security_from_verification_completion",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].roleContractId, "security_agent");
  assert.equal(followupRuns[0].providerPreference, "claude");
  assert.ok(
    executionCalls.some(
      (call) => call.runId === followupRuns[0].id && call.agentId === "a-verifier",
    ),
  );
});

test("completed release branches into a dedicated ops follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.activeMissionId = "m-1";
  seededState.activeRunId = "r-release-complete";
  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-researcher" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-release-complete",
    missionId: "m-1",
    agentId: "a-verifier",
    roleContractId: "release_agent",
    title: "Release checkout auth patch",
    status: "completed",
    summary: "Release package was assembled and handed off.",
    budgetClass: "light",
    providerPreference: "claude",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [
      {
        id: "tl-release-start",
        kind: "started",
        summary: "Release run started.",
        timestampLabel: "3m ago",
      },
      {
        id: "tl-release-complete",
        kind: "completed",
        summary: "Release run completed.",
        timestampLabel: "just now",
      },
    ],
    decisions: [],
    artifacts: [
      runtimeArtifacts.createArtifactRecord({
        id: "art-release-manifest-complete",
        type: "report",
        title: "Release manifest",
        preview: "Manifest is attached.",
        contractKind: "release_manifest",
        payload: {
          summary: "Release manifest for checkout auth patch.",
          approvedRevisionId: "del-release-ready-r1",
          artifactIds: ["art-release-manifest-complete"],
          evidencePackIds: ["art-release-evidence-complete"],
          qualityGates: {
            functionalStatus: "pass",
            visualStatus: "not_applicable",
            bugRiskStatus: "pass",
            smokeStatus: "pass",
            knownIssues: [],
          },
          releaseChecklist: ["Approved revision is attached."],
        },
      }),
      runtimeArtifacts.createArtifactRecord({
        id: "art-release-handoff-complete",
        type: "handoff",
        title: "Release handoff",
        preview: "Release package was handed off.",
        contractKind: "handoff_record",
        payload: {
          deliverableRevisionId: "del-release-ready-r1",
          channel: "inbox",
          target: "human reviewer",
          status: "active",
          relatedArtifactIds: ["art-release-manifest-complete"],
        },
      }),
    ],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  });
  seededState.runEventsByRunId["r-release-complete"] = [
    {
      id: "ev-release-complete",
      runId: "r-release-complete",
      agentId: "a-verifier",
      kind: "completed",
      summary: "Release pass completed.",
      createdAtLabel: "just now",
      metadata: {
        source: "mock",
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
    (run) => run.origin?.schedulerRuleId === "ops_from_release_completion",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].roleContractId, "ops_agent");
  assert.equal(followupRuns[0].providerPreference, "gemini");
  assert.equal(followupRuns[0].deliverables[0].kind, "deployment_note");
  assert.match(followupRuns[0].deliverables[0].title, /deployment note/i);
  assert.ok(
    executionCalls.some(
      (call) => call.runId === followupRuns[0].id && call.agentId === "a-researcher",
    ),
  );
});

test("completed ops branches into a dedicated learning follow-up run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  seededState.activeMissionId = "m-1";
  seededState.activeRunId = "r-ops-complete";
  seededState.autopilotHandledEventIdsByRunId["r-1"] = [
    ...(seededState.runEventsByRunId["r-1"] ?? []).map((event) => event.id),
  ];
  seededState.agentsByMissionId["m-1"] = seededState.agentsByMissionId["m-1"].map((agent) =>
    agent.id === "a-researcher" ? { ...agent, status: "idle" } : agent,
  );
  seededState.runsByMissionId["m-1"].push({
    id: "r-ops-complete",
    missionId: "m-1",
    agentId: "a-researcher",
    roleContractId: "ops_agent",
    title: "Operate checkout auth release",
    status: "completed",
    summary: "Operational follow-up classified the latest release signal.",
    budgetClass: "light",
    providerPreference: "gemini",
    activeSurface: "artifacts",
    terminalPreview: [],
    timeline: [
      {
        id: "tl-ops-start",
        kind: "started",
        summary: "Ops run started.",
        timestampLabel: "4m ago",
      },
      {
        id: "tl-ops-complete",
        kind: "completed",
        summary: "Ops run completed.",
        timestampLabel: "just now",
      },
    ],
    decisions: [],
    artifacts: [
      runtimeArtifacts.createArtifactRecord({
        id: "art-ops-incident",
        type: "report",
        title: "Incident record",
        preview: "Operational incident is attached.",
        contractKind: "incident_record",
        payload: {
          summary: "Intermittent checkout retries were observed after rollout.",
          severity: "medium",
          affectedMissionId: "m-1",
          affectedRunId: "r-ops-complete",
          symptoms: ["Checkout retries spike under load."],
          nextActions: ["Codify the retry pattern in a learning pass."],
        },
      }),
      runtimeArtifacts.createArtifactRecord({
        id: "art-ops-improvement",
        type: "report",
        title: "Improvement proposal",
        preview: "Operational improvement proposal is attached.",
        contractKind: "improvement_proposal",
        payload: {
          title: "Capture retry spikes earlier",
          summary: "Classify retry spikes before they become human tickets.",
          hypothesis: "Earlier classification reduces noisy escalations.",
          expectedImpact: "Cleaner operations routing.",
          requiredEvals: ["Replay the incident classifier against the latest release log."],
          relatedArtifactIds: ["art-ops-incident"],
        },
      }),
    ],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  });
  seededState.runEventsByRunId["r-ops-complete"] = [
    {
      id: "ev-ops-complete",
      runId: "r-ops-complete",
      agentId: "a-researcher",
      kind: "completed",
      summary: "Ops pass completed.",
      createdAtLabel: "just now",
      metadata: {
        source: "mock",
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
    (run) => run.origin?.schedulerRuleId === "learning_from_ops_completion",
  );

  assert.equal(followupRuns.length, 1);
  assert.equal(followupRuns[0].roleContractId, "learning_agent");
  assert.equal(followupRuns[0].providerPreference, "gemini");
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
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: createNoopExecutionService(),
  });
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

  const activeRun = runtime.getActiveRun();
  assert.ok(activeRun);
  assert.ok(
    activeRun.artifacts.some((artifact) => artifact.contractKind === "acceptance_checks"),
  );
  assert.equal(activeRun.deliverables.length, 0);
  assert.equal(activeRun.handoffs.length, 0);
  assert.deepEqual(activeRun.runEvents, []);
});

test("setting the active mission also selects its workspace and run", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: createNoopExecutionService(),
  });

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

test("end-to-end: mission creation through auto-approval to completion", {
  skip: "Disabled by default: this flow leaves pending async work and can wedge node --test on WSL.",
}, () => {
  const completionCallbacks = [];
  const executionCalls = [];

  const emptyState = () => ({
    activeWorkspaceId: "",
    activeMissionId: "",
    activeRunId: "",
    missionBudgetById: {},
    workspaces: [],
    missions: [],
    missionDetailsById: {},
    workspaceIdByMissionId: {},
    agentsByMissionId: {},
    runsByMissionId: {},
    runEventsByRunId: {},
    lifecycleEventsByMissionId: {},
    autopilotHandledEventIdsByRunId: {},
  });
  const store = new runtimeStore.MemoryRuntimeStore(emptyState);
  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    executionService: {
      spawnAgentRun(input) {
        executionCalls.push({
          runId: input.runId,
          agentId: input.agent.id,
          role: input.agent.role,
          objective: input.objective,
        });
        completionCallbacks.push(input.onComplete);
        return true;
      },
      writeTerminalSession() { return false; },
      resizeTerminalSession() { return false; },
      killTerminalSession() {},
    },
  });

  const workspaceId = runtime.listWorkspaces()[0].id;
  const mission = runtime.createMission({
    workspaceId,
    title: "Fix checkout bug",
    goal: "Patch the checkout auth regression.",
  });

  // Initial conductor run should have been spawned
  assert.ok(executionCalls.length >= 1);
  const conductorCall = executionCalls.find((c) => c.role === "coordination");
  assert.ok(conductorCall, "conductor should be spawned on mission creation");

  // Simulate conductor completion
  const conductorCallback = completionCallbacks.shift();
  conductorCallback({
    missionId: mission.id,
    runId: conductorCall.runId,
    agentId: conductorCall.agentId,
    summary: "Conductor shaped the execution plan.",
    source: "provider",
    outcome: "completed",
  });

  // Run autopilot to process conductor completion
  runtime.autopilotBurst({ maxSteps: 8 });

  // Complete any spawned follow-up agents until a verification agent completes
  let iterations = 0;
  while (completionCallbacks.length > 0 && iterations < 20) {
    const callback = completionCallbacks.shift();
    const call = executionCalls[executionCalls.length - completionCallbacks.length - 1];
    callback({
      missionId: mission.id,
      runId: call?.runId ?? "unknown",
      agentId: call?.agentId ?? "unknown",
      summary: `Agent completed work.`,
      source: "provider",
      outcome: "completed",
      generatedPatch: call?.role === "implementation"
        ? "diff --git a/fix.ts b/fix.ts\n@@\n-old\n+new"
        : undefined,
    });
    runtime.autopilotBurst({ maxSteps: 8 });
    iterations += 1;
  }

  const state = store.read();
  const missionStatus = state.missions.find((m) => m.id === mission.id)?.status;
  const runs = state.runsByMissionId[mission.id] ?? [];
  const completedRuns = runs.filter((r) => r.status === "completed");
  const approvedRevisions = runs.flatMap((r) =>
    (r.deliverables ?? []).flatMap((d) =>
      d.revisions.filter((rev) => rev.status === "approved"),
    ),
  );

  assert.ok(
    executionCalls.length >= 2,
    `expected multiple agent executions, got ${executionCalls.length}`,
  );
  assert.ok(
    completedRuns.length >= 1,
    `expected at least 1 completed run, got ${completedRuns.length}`,
  );
  assert.ok(
    approvedRevisions.length >= 1,
    `expected auto-approved revision, got ${approvedRevisions.length}`,
  );
  assert.equal(missionStatus, "completed", "mission should be auto-completed");
});
