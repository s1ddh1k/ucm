import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as runtimeExecution from "../dist-electron/main/runtime-execution.js";
import * as runtimeArtifacts from "../dist-electron/main/runtime-artifacts.js";
import * as runtimeHelpers from "../dist-electron/main/runtime-run-helpers.js";
import * as runtimeRoleRegistry from "../dist-electron/main/runtime-role-registry.js";
import * as runtimeServiceModule from "../dist-electron/main/runtime.js";
import * as runtimeState from "../dist-electron/main/runtime-state.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";

const repoRoot = path.resolve(process.cwd(), "..");

test("runtime role registry loads YAML contracts and validates artifact payloads", () => {
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });

  assert.equal(registry.diagnostics.length, 0);
  assert.equal(registry.enforceRoleContracts, true);
  assert.equal(registry.hasRoleContract("builder_agent"), true);
  assert.equal(registry.getRoleContract("builder_agent")?.policyCeiling, "L2");

  const validation = registry.validateArtifact("evidence_pack", {
    id: "evp-1",
    decision: "promote_to_review",
    checks: [],
    artifactIds: [],
    generatedAtLabel: "just now",
  });

  assert.equal(validation.enforced, true);
  assert.equal(validation.valid, true);
});

test("runtime service normalizes legacy runs with inferred role contracts", () => {
  const store = new runtimeStore.MemoryRuntimeStore(runtimeState.cloneSeed);
  const seededState = store.read();
  delete seededState.runsByMissionId["m-1"][0].roleContractId;
  store.write(seededState);

  const runtime = new runtimeServiceModule.RuntimeService({
    store,
    roleRegistry: runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot }),
  });
  const activeRun = runtime.getActiveRun();

  assert.ok(activeRun);
  assert.equal(activeRun.roleContractId, "builder_agent");
});

test("execution blocks a run when the attached role contract is incompatible", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  run.status = "running";
  run.roleContractId = "research_agent";
  state.agentsByMissionId["m-1"] = state.agentsByMissionId["m-1"].map((agent) =>
    agent.id === run.agentId ? { ...agent, status: "running" } : agent,
  );

  let executionCalls = 0;
  runtimeExecution.maybeStartAgentExecutionInState({
    state,
    missionId: "m-1",
    runId: run.id,
    agentId: run.agentId,
    executionService: {
      spawnAgentRun() {
        executionCalls += 1;
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
    roleRegistry: registry,
    callbacks: {
      onSessionStart() {},
      onTerminalData() {},
      onComplete() {},
    },
  });

  const latestEvent = (state.runEventsByRunId[run.id] ?? []).at(-1);
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);

  assert.equal(executionCalls, 0);
  assert.equal(run.status, "blocked");
  assert.equal(agent?.status, "blocked");
  assert.equal(latestEvent?.kind, "blocked");
  assert.equal(latestEvent?.metadata?.source, "role_contract_validation");
});

test("partial role registry allows execution even when contracts are not fully enforceable", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-role-registry-"));
  fs.mkdirSync(path.join(tempRoot, "roles", "contracts"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "schemas", "artifacts"), { recursive: true });

  for (const fileName of [
    "role-contract.schema.json",
    path.join("artifacts", "acceptance-checks.schema.json"),
    path.join("artifacts", "alternative-set.schema.json"),
    path.join("artifacts", "review-packet.schema.json"),
    path.join("artifacts", "evidence-pack.schema.json"),
  ]) {
    const source = path.join(repoRoot, "schemas", fileName);
    const target = path.join(tempRoot, "schemas", fileName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  fs.copyFileSync(
    path.join(repoRoot, "roles", "contracts", "builder_agent.yaml"),
    path.join(tempRoot, "roles", "contracts", "builder_agent.yaml"),
  );

  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot: tempRoot });

  assert.equal(registry.enforceRoleContracts, false);
  assert.ok(
    registry.diagnostics.some((message) =>
      message.includes('Missing role contract for "conductor"'),
    ),
  );

  const state = runtimeState.cloneSeed();
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);
  run.status = "running";
  state.agentsByMissionId["m-1"] = state.agentsByMissionId["m-1"].map((existing) =>
    existing.id === agent.id ? { ...existing, status: "running" } : existing,
  );

  let executionCalls = 0;
  runtimeExecution.maybeStartAgentExecutionInState({
    state,
    missionId: "m-1",
    runId: run.id,
    agentId: run.agentId,
    executionService: {
      spawnAgentRun() {
        executionCalls += 1;
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
    roleRegistry: registry,
    callbacks: {
      onSessionStart() {},
      onTerminalData() {},
      onComplete() {},
    },
  });

  assert.equal(executionCalls, 1);
  assert.equal(run.status, "running");
  assert.equal(
    state.agentsByMissionId["m-1"].find((item) => item.id === agent.id)?.status,
    "running",
  );
});

test("runtime role registry enforces canonical role contract filenames", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-role-registry-"));
  fs.cpSync(path.join(repoRoot, "roles"), path.join(tempRoot, "roles"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "schemas"), path.join(tempRoot, "schemas"), { recursive: true });

  const contractsDir = path.join(tempRoot, "roles", "contracts");
  fs.renameSync(
    path.join(contractsDir, "builder_agent.yaml"),
    path.join(contractsDir, "builder-agent.yaml"),
  );

  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot: tempRoot });

  assert.equal(registry.enforceRoleContracts, false);
  assert.ok(
    registry.diagnostics.some(
      (message) =>
        message.includes("Role contract \"builder_agent\" should be named builder_agent.yaml"),
    ),
  );
  assert.equal(registry.hasRoleContract("builder_agent"), true);
});

test("role contract start validation blocks runs missing required inputs", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  run.roleContractId = "builder_agent";
  run.decisions = [];
  state.missionDetailsById["m-1"] = {
    ...state.missionDetailsById["m-1"],
    successCriteria: [],
    phases: [],
  };

  const validation = runtimeRoleRegistry.validateRoleContractRunStart({
    state,
    missionId: "m-1",
    run,
    agent,
    roleRegistry: registry,
    preferredProvider: "codex",
  });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((message) => message.includes('Missing required input "task_backlog"')),
  );
  assert.ok(
    validation.errors.some((message) => message.includes('Missing required input "decision_record"')),
  );
  assert.ok(
    validation.errors.some((message) =>
      message.includes('Missing required input "acceptance_checks"'),
    ),
  );
});

test("invalid explicit artifact payloads do not satisfy required builder inputs", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  run.roleContractId = "builder_agent";
  run.decisions = [];
  run.artifacts = [
    runtimeArtifacts.createArtifactRecord({
      id: "art-invalid-backlog",
      type: "report",
      title: "Invalid task backlog",
      preview: "Backlog payload is malformed.",
      contractKind: "task_backlog",
      payload: {
        tasks: [{ id: "task-1" }],
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-valid-decision",
      type: "report",
      title: "Decision record",
      preview: "Decision artifact is valid.",
      contractKind: "decision_record",
      payload: {
        id: "d-valid",
        category: "planning",
        summary: "Proceed with a narrow patch.",
        rationale: "Keep the first pass bounded.",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-valid-acceptance",
      type: "report",
      title: "Acceptance checks",
      preview: "Acceptance payload is valid.",
      contractKind: "acceptance_checks",
      payload: {
        checks: [
          {
            id: "ac-1",
            description: "Regression path is covered.",
            blocking: true,
            verificationMethod: "test",
            severity: "must",
          },
        ],
      },
    }),
  ];
  state.missionDetailsById["m-1"] = {
    ...state.missionDetailsById["m-1"],
    successCriteria: [],
    phases: [],
  };

  const validation = runtimeRoleRegistry.validateRoleContractRunStart({
    state,
    missionId: "m-1",
    run,
    agent,
    roleRegistry: registry,
    preferredProvider: "codex",
  });

  assert.equal(run.artifacts[0].payloadValidation?.valid, false);
  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((message) => message.includes('Missing required input "task_backlog"')),
  );
});

test("release start validation requires approved review provenance, not just a review packet artifact", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  agent.role = "verification";
  run.roleContractId = "release_agent";
  run.artifacts = [
    runtimeArtifacts.createArtifactRecord({
      id: "art-review-packet",
      type: "report",
      title: "Review packet",
      preview: "Review packet exists but is not approved yet.",
      contractKind: "review_packet",
      payload: {
        summary: "Ready for release review.",
        selectedApproach: "Patch the checkout fallback flow.",
        artifactIds: ["art-review-packet"],
        evidencePackIds: ["art-evidence-pack"],
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
      id: "art-evidence-pack",
      type: "report",
      title: "Evidence pack",
      preview: "Evidence pack is attached.",
      contractKind: "evidence_pack",
      payload: {
        id: "evp-release-1",
        missionId: "m-1",
        runId: "r-1",
        decision: "promote_to_review",
        checks: [],
        artifactIds: ["art-review-packet"],
        generatedAtLabel: "just now",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-rollback-plan",
      type: "report",
      title: "Rollback plan",
      preview: "Rollback plan is attached.",
      contractKind: "rollback_plan",
      payload: {
        summary: "Rollback to the previously approved release.",
        triggerConditions: ["User-facing regression appears after release."],
        rollbackSteps: ["Revert to the last approved revision."],
        verificationSteps: ["Re-run the release smoke checks."],
      },
    }),
  ];
  run.deliverables = [];

  const invalid = runtimeRoleRegistry.validateRoleContractRunStart({
    state,
    missionId: "m-1",
    run,
    agent,
    roleRegistry: registry,
    preferredProvider: "claude",
  });

  assert.equal(invalid.valid, false);
  assert.ok(
    invalid.errors.some((message) => message.includes('Missing required input "review_packet"')),
  );

  run.artifacts.push(
    runtimeArtifacts.createArtifactRecord({
      id: "art-approved-revision",
      type: "report",
      title: "Approved review packet revision",
      preview: "Approved provenance is attached.",
      contractKind: "deliverable_revision",
      payload: {
        deliverableId: "del-release",
        deliverableKind: "review_packet",
        revisionId: "del-release-r2",
        revisionNumber: 2,
        summary: "Approved review packet revision.",
        basedOnArtifactIds: ["art-review-packet"],
        status: "approved",
      },
    }),
  );

  const valid = runtimeRoleRegistry.validateRoleContractRunStart({
    state,
    missionId: "m-1",
    run,
    agent,
    roleRegistry: registry,
    preferredProvider: "claude",
  });

  assert.equal(valid.valid, true);
});

test("security completion emits an explicit security report", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  agent.role = "verification";
  run.agentId = agent.id;
  run.roleContractId = "security_agent";
  run.status = "running";
  run.artifacts = [
    runtimeArtifacts.createArtifactRecord({
      id: "art-security-patch",
      type: "diff",
      title: "Patch set",
      preview: "Security inspection input patch.",
      contractKind: "patch_set",
      payload: {
        runId: run.id,
        summary: "Patch set is ready for security inspection.",
        patchLength: 42,
      },
    }),
  ];
  run.outputBaseline = runtimeHelpers.captureRunOutputBaseline(run);

  const completed = runtimeExecution.completeAgentRunInState(
    state,
    {
      missionId: "m-1",
      runId: run.id,
      agentId: agent.id,
      summary: "Security review flagged a medium-risk boundary change.",
      source: "provider",
      outcome: "completed",
    },
    registry,
  );

  assert.ok(completed);
  assert.equal(run.status, "completed");
  assert.ok(run.artifacts.some((artifact) => artifact.contractKind === "security_report"));
});

test("reviewer completion emits fresh review outputs instead of relying on inherited state", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  agent.role = "verification";
  run.agentId = agent.id;
  run.roleContractId = "reviewer_agent";
  run.status = "running";
  run.decisions = [
    {
      id: "d-review-baseline",
      category: "planning",
      summary: "Inherited review context.",
      rationale: "Seeded from the source run.",
    },
  ];
  run.deliverables = [];
  run.outputBaseline = runtimeHelpers.captureRunOutputBaseline(run);

  const completed = runtimeExecution.completeAgentRunInState(
    state,
    {
      missionId: "m-1",
      runId: run.id,
      agentId: agent.id,
      summary: "Verifier finished a narrow pass.",
      source: "provider",
      outcome: "completed",
      stdout: "Completed verification pass.",
    },
    registry,
  );

  assert.ok(completed);
  const reviewPacket = run.artifacts.find((artifact) => artifact.contractKind === "review_packet");
  const decisionArtifact = run.artifacts.find((artifact) => artifact.contractKind === "decision_record");
  const evidenceArtifact = run.artifacts.find((artifact) => artifact.contractKind === "evidence_pack");
  const latestEvent = (state.runEventsByRunId[run.id] ?? []).at(-1);

  assert.ok(reviewPacket);
  assert.ok(decisionArtifact);
  assert.ok(evidenceArtifact);
  assert.ok(["pass", "warn", "fail"].includes(reviewPacket?.payload?.functionalStatus));
  assert.equal(reviewPacket?.payload?.visualStatus, "not_applicable");
  assert.ok(Array.isArray(reviewPacket?.payload?.knownIssues));
  assert.notEqual(latestEvent?.metadata?.source, "role_contract_output_validation");
});

test("release completion is blocked when quality gates are not release ready", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  agent.role = "verification";
  run.agentId = agent.id;
  run.roleContractId = "release_agent";
  run.status = "running";
  run.deliverables = [
    {
      id: "del-release",
      kind: "review_packet",
      title: "Approved review packet",
      latestRevisionId: "del-release-r1",
      revisions: [
        {
          id: "del-release-r1",
          revision: 1,
          summary: "Approved review packet.",
          createdAtLabel: "just now",
          basedOnArtifactIds: ["art-review-ready"],
          status: "approved",
        },
      ],
    },
  ];
  run.artifacts = [
    runtimeArtifacts.createArtifactRecord({
      id: "art-review-ready",
      type: "report",
      title: "Approved review packet",
      preview: "Review packet is approved but visual quality is still unresolved.",
      contractKind: "review_packet",
      payload: {
        summary: "Approved review packet.",
        selectedApproach: "Keep the checkout patch narrow.",
        artifactIds: ["art-review-ready"],
        evidencePackIds: ["art-evidence-ready"],
        functionalStatus: "pass",
        visualStatus: "warn",
        bugRiskStatus: "pass",
        smokeStatus: "pass",
        surfacesReviewed: ["checkout-screen"],
        knownIssues: ["Visual spacing still needs confirmation on the checkout screen."],
        openRisks: ["Visual spacing still needs confirmation on the checkout screen."],
        requestedAction: "review",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-evidence-ready",
      type: "report",
      title: "Evidence pack",
      preview: "Evidence pack is attached.",
      contractKind: "evidence_pack",
      payload: {
        id: "evp-release-ready",
        missionId: "m-1",
        runId: "r-1",
        decision: "promote_to_completion",
        checks: [],
        artifactIds: ["art-review-ready"],
        generatedAtLabel: "just now",
      },
    }),
    runtimeArtifacts.createArtifactRecord({
      id: "art-rollback-ready",
      type: "report",
      title: "Rollback plan",
      preview: "Rollback plan is attached.",
      contractKind: "rollback_plan",
      payload: {
        summary: "Rollback to the previous approved revision.",
        triggerConditions: ["Visual regression is confirmed after release."],
        rollbackSteps: ["Restore the previous checkout assets."],
        verificationSteps: ["Re-run the checkout smoke suite."],
      },
    }),
  ];
  run.outputBaseline = runtimeHelpers.captureRunOutputBaseline(run);

  const completed = runtimeExecution.completeAgentRunInState(
    state,
    {
      missionId: "m-1",
      runId: run.id,
      agentId: agent.id,
      summary: "Release package was assembled.",
      source: "provider",
      outcome: "completed",
      stdout: "Release package created.",
    },
    registry,
  );

  assert.ok(completed);
  assert.equal(run.status, "blocked");
  const latestEvent = (state.runEventsByRunId[run.id] ?? []).at(-1);
  assert.equal(latestEvent?.metadata?.source, "role_contract_output_validation");
  assert.match(latestEvent?.metadata?.reason ?? "", /visual quality gate|known issues/i);
});

test("inherited review packet inputs do not count as fresh reviewer outputs before completion", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];
  const agent = state.agentsByMissionId["m-1"].find((item) => item.id === run.agentId);
  assert.ok(agent);

  agent.role = "verification";
  run.agentId = agent.id;
  run.roleContractId = "reviewer_agent";
  run.status = "running";
  run.decisions = [
    {
      id: "d-review-baseline",
      category: "planning",
      summary: "Inherited review context.",
      rationale: "Seeded from the source run.",
    },
  ];
  run.deliverables = [
    {
      id: "del-review",
      kind: "review_packet",
      title: "Inherited review packet",
      latestRevisionId: "del-review-r1",
      revisions: [
        {
          id: "del-review-r1",
          revision: 1,
          summary: "Inherited revision from source run.",
          createdAtLabel: "just now",
          basedOnArtifactIds: ["art-1"],
          status: "active",
        },
      ],
    },
  ];
  run.outputBaseline = {
    artifactCount: run.artifacts.length,
    artifactContractCounts: {
      patch_set: 1,
      decision_record: 1,
      review_packet: 1,
    },
    diffArtifactCount: run.artifacts.filter((artifact) => artifact.type === "diff").length,
    testArtifactCount: run.artifacts.filter((artifact) => artifact.type === "test_result").length,
    reportArtifactCount: run.artifacts.filter((artifact) => artifact.type === "report").length,
    decisionCount: run.decisions.length,
    deliverableRevisionCount: 1,
    handoffCount: 0,
    timelineCount: run.timeline.length,
  };

  const validation = runtimeRoleRegistry.validateRoleContractRunCompletion({
    state,
    missionId: "m-1",
    run,
    agent,
    roleRegistry: registry,
  });

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((message) => message.includes('review_packet')));
});

test("builder completion without a real patch is blocked instead of minting a synthetic diff", () => {
  const state = runtimeState.cloneSeed();
  const registry = runtimeRoleRegistry.loadRuntimeRoleRegistry({ repoRoot });
  const run = state.runsByMissionId["m-1"][0];

  run.status = "running";
  run.artifacts = [];
  run.decisions = [
    {
      id: "d-build",
      category: "technical",
      summary: "Apply a bounded checkout fix.",
      rationale: "Keep the patch narrow.",
    },
  ];
  run.deliverables = [];
  run.outputBaseline = {
    artifactCount: 0,
    artifactContractCounts: {},
    diffArtifactCount: 0,
    testArtifactCount: 0,
    reportArtifactCount: 0,
    decisionCount: 1,
    deliverableRevisionCount: 0,
    handoffCount: 0,
    timelineCount: run.timeline.length,
  };

  const completed = runtimeExecution.completeAgentRunInState(
    state,
    {
      missionId: "m-1",
      runId: run.id,
      agentId: run.agentId,
      summary: "Builder reported completion but no patch was captured.",
      source: "provider",
      outcome: "completed",
      stdout: "Completed the implementation pass.",
    },
    registry,
  );

  assert.ok(completed);
  assert.equal(run.status, "blocked");
  assert.equal(completed.run.artifacts.at(-1)?.type, "report");
  const latestEvent = (state.runEventsByRunId[run.id] ?? []).at(-1);
  assert.equal(latestEvent?.metadata?.source, "role_contract_output_validation");
  assert.match(latestEvent?.metadata?.reason ?? "", /patch_set/);
});
