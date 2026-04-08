import type { RuntimeState } from "./runtime-state";

const seedState: RuntimeState = {
  activeWorkspaceId: "ws-storefront",
  activeMissionId: "m-1",
  activeRunId: "r-1",
  missionBudgetById: {
    "m-1": {
      light: { limit: 4, used: 1 },
      standard: { limit: 2, used: 0 },
      heavy: { limit: 1, used: 0 },
    },
    "m-2": {
      light: { limit: 3, used: 1 },
      standard: { limit: 1, used: 0 },
      heavy: { limit: 0, used: 0 },
    },
    "m-3": {
      light: { limit: 2, used: 0 },
      standard: { limit: 1, used: 0 },
      heavy: { limit: 0, used: 0 },
    },
  },
  workspaces: [
    {
      id: "ws-storefront",
      name: "storefront-app",
      rootPath: "/workspaces/storefront-app",
      active: true,
    },
    {
      id: "ws-mobile",
      name: "mobile-checkout",
      rootPath: "/workspaces/mobile-checkout",
      active: false,
    },
  ],
  missions: [
    {
      id: "m-1",
      title: "Checkout rollback fix",
      status: "running",
      goal: "Restore checkout stability without breaking auth flow.",
    },
    {
      id: "m-2",
      title: "Release prep",
      status: "review",
      goal: "Prepare the release checklist and final verification package.",
    },
    {
      id: "m-3",
      title: "Billing edge cases",
      status: "queued",
      goal: "Map unresolved billing edge cases and propose next actions.",
    },
  ],
  missionDetailsById: {
    "m-1": {
      id: "m-1",
      title: "Checkout rollback fix",
      status: "running",
      goal: "Restore checkout stability without breaking auth flow.",
      successCriteria: [
        "Checkout succeeds for password and social login flows.",
        "Auth session restoration remains intact.",
        "Regression test suite is green before approval.",
      ],
      constraints: [
        "No schema change.",
        "Avoid risky auth layer rewrites.",
        "Keep the change deploy-safe for rollback.",
      ],
      risks: [
        "Hidden auth coupling may surface late.",
        "Flaky tests may mask a real redirect regression.",
      ],
      phases: [
        {
          id: "p-1",
          title: "Reproduce the regression",
          objective: "Confirm the auth redirect failure path and collect traces.",
          status: "done",
        },
        {
          id: "p-2",
          title: "Patch checkout auth flow",
          objective: "Apply a low-risk fix in the checkout session recovery logic.",
          status: "active",
        },
        {
          id: "p-3",
          title: "Verify and review",
          objective: "Run regression tests and produce approval-ready artifacts.",
          status: "todo",
        },
      ],
      agentIds: [
        "a-conductor",
        "a-builder-1",
        "a-builder-2",
        "a-architect",
        "a-researcher",
        "a-verifier",
      ],
    },
    "m-2": {
      id: "m-2",
      title: "Release prep",
      status: "review",
      goal: "Prepare the release checklist and final verification package.",
      successCriteria: [
        "Release checklist is complete.",
        "Known risks are documented and assigned.",
      ],
      constraints: ["No new implementation work in this mission."],
      risks: ["A late blocker may invalidate the release package."],
      phases: [
        {
          id: "p-r1",
          title: "Collect release signals",
          objective: "Gather open defects, blockers, and owner acknowledgements.",
          status: "done",
        },
      ],
      agentIds: [],
    },
    "m-3": {
      id: "m-3",
      title: "Billing edge cases",
      status: "queued",
      goal: "Map unresolved billing edge cases and propose next actions.",
      successCriteria: ["Edge cases are categorized with owners and severity."],
      constraints: ["Research only. No production code changes yet."],
      risks: ["External provider docs may be incomplete."],
      phases: [
        {
          id: "p-b1",
          title: "Collect historical incidents",
          objective: "Compile edge-case failures from support and telemetry.",
          status: "todo",
        },
      ],
      agentIds: [],
    },
  },
  workspaceIdByMissionId: {
    "m-1": "ws-storefront",
    "m-2": "ws-storefront",
    "m-3": "ws-storefront",
  },
  agentsByMissionId: {
    "m-1": [
      {
        id: "a-conductor",
        name: "Conductor",
        role: "coordination",
        status: "running",
        objective: "Rebalance work and resolve bottlenecks across the team.",
      },
      {
        id: "a-builder-1",
        name: "Builder-1",
        role: "implementation",
        status: "running",
        objective: "Patch checkout auth regression without schema changes.",
      },
      {
        id: "a-builder-2",
        name: "Builder-2",
        role: "implementation",
        status: "blocked",
        objective: "Validate fallback path for session restore edge cases.",
      },
      {
        id: "a-architect",
        name: "Architect",
        role: "design",
        status: "idle",
        objective: "Review auth coupling risk and propose escape hatches.",
      },
      {
        id: "a-researcher",
        name: "Researcher",
        role: "research",
        status: "running",
        objective: "Collect prior incidents and rollback patterns.",
      },
      {
        id: "a-verifier",
        name: "Verifier",
        role: "verification",
        status: "needs_review",
        objective: "Summarize failing test matrix and produce review artifacts.",
      },
    ],
  },
  runsByMissionId: {
    "m-1": [
      {
        id: "r-1",
        missionId: "m-1",
        agentId: "a-builder-2",
        roleContractId: "builder_agent",
        title: "Patch checkout auth regression",
        status: "blocked",
        summary:
          "Builder-2 patched the fallback branch and is now blocked on a missing fixture path.",
        budgetClass: "standard",
        providerPreference: "codex",
        terminalSessionId: undefined,
        terminalProvider: undefined,
        activeSurface: "terminal",
        terminalPreview: [
          "$ npm test auth-redirect.spec.ts",
          "FAIL auth-redirect.spec.ts",
          "Expected fixture /fixtures/session-restore.json was not found.",
          "Builder-2 paused and asked for the correct fixture path.",
        ],
        timeline: [
          {
            id: "tl-1",
            kind: "started",
            summary: "Run started with checkout auth regression objective.",
            timestampLabel: "18m ago",
          },
          {
            id: "tl-2",
            kind: "context_loaded",
            summary: "Loaded prior rollback notes and auth helper references.",
            timestampLabel: "17m ago",
          },
          {
            id: "tl-3",
            kind: "tool_running",
            summary: "Executed focused test run for auth redirect spec.",
            timestampLabel: "12m ago",
          },
          {
            id: "tl-4",
            kind: "artifact_created",
            summary: "Produced a partial diff and test report artifact.",
            timestampLabel: "8m ago",
          },
          {
            id: "tl-5",
            kind: "blocked",
            summary: "Waiting for the fixture path required to resume verification.",
            timestampLabel: "3m ago",
          },
        ],
        decisions: [
          {
            id: "d-1",
            category: "technical",
            summary: "Reuse the existing auth helper instead of introducing a new session branch.",
            rationale: "Keeps the patch small and reduces deploy risk.",
          },
          {
            id: "d-2",
            category: "risk",
            summary: "Avoid token refresh path changes in this mission.",
            rationale: "The current failure is narrower than the full auth stack.",
          },
        ],
        artifacts: [
          {
            id: "art-1",
            type: "diff",
            title: "Partial auth fallback diff",
            preview: "checkout/session.ts and auth/recover.ts modified",
            filePatches: [
              {
                path: "src/checkout/session.ts",
                summary: "Fallback fixture resolution now flows through a dedicated helper.",
                patch: `diff --git a/src/checkout/session.ts b/src/checkout/session.ts
@@
-const fixturePath = "/fixtures/session-restore.json";
+const fixturePath = resolveCheckoutFixture();
+
+function resolveCheckoutFixture() {
+  return process.env.CHECKOUT_FIXTURE_PATH ?? "/fixtures/checkout-session-restore.json";
+}`,
              },
              {
                path: "src/auth/recover.ts",
                summary: "Checkout recovery now uses the narrower recovery path.",
                patch: `diff --git a/src/auth/recover.ts b/src/auth/recover.ts
@@
-return refreshSession(token);
+return recoverCheckoutSession(token);`,
              },
              {
                path: "test/auth-redirect.spec.ts",
                summary: "Regression spec now points at the checkout-specific fixture.",
                patch: `diff --git a/test/auth-redirect.spec.ts b/test/auth-redirect.spec.ts
@@
-const fixture = loadFixture("/fixtures/session-restore.json");
+const fixture = loadFixture(resolveCheckoutFixture());`,
              },
            ],
          },
          {
            id: "art-2",
            type: "test_result",
            title: "Focused auth redirect test report",
            preview: "1 failing fixture dependency blocks resume",
          },
        ],
        deliverables: [
          {
            id: "del-1",
            kind: "merge_handoff",
            title: "Checkout auth merge handoff",
            latestRevisionId: "del-1-r2",
            revisions: [
              {
                id: "del-1-r1",
                revision: 1,
                summary:
                  "Initial handoff packet with partial diff and failing test note.",
                createdAtLabel: "9m ago",
                basedOnArtifactIds: ["art-1", "art-2"],
                status: "superseded",
              },
              {
                id: "del-1-r2",
                revision: 2,
                summary:
                  "Updated handoff packet with narrower risk framing and clearer resume note.",
                createdAtLabel: "2m ago",
                basedOnArtifactIds: ["art-1", "art-2"],
                status: "active",
              },
            ],
          },
          {
            id: "dv-review-1",
            kind: "review_packet",
            title: "Review packet for checkout auth fix",
            latestRevisionId: "dv-1",
            revisions: [
              {
                id: "dv-1",
                revision: 1,
                summary: "Initial review packet draft prepared for bootstrap.",
                createdAtLabel: "18m ago",
                basedOnArtifactIds: ["art-1", "art-2"],
                status: "superseded",
              },
            ],
          },
        ],
        runEvents: [],
        handoffs: [
          {
            id: "handoff-1",
            deliverableRevisionId: "del-1-r2",
            channel: "inbox",
            target: "human reviewer",
            createdAtLabel: "1m ago",
            status: "active",
          },
        ],
      },
    ],
  },
  runEventsByRunId: {
    "r-1": [
      {
        id: "ev-1",
        runId: "r-1",
        agentId: "a-builder-2",
        kind: "artifact_created",
        summary: "Builder-2 produced a partial diff and focused test report.",
        createdAtLabel: "8m ago",
      },
      {
        id: "ev-2",
        runId: "r-1",
        agentId: "a-builder-2",
        kind: "blocked",
        summary: "Builder-2 is blocked on the missing fixture path for resume.",
        createdAtLabel: "3m ago",
        metadata: {
          requestedInput: "fixture_path",
        },
      },
    ],
  },
  lifecycleEventsByMissionId: {
    "m-1": [
      {
        id: "lc-1",
        missionId: "m-1",
        agentId: "a-builder-2",
        kind: "spawned",
        summary: "Builder-2 started because the checkout patch phase became active.",
        createdAtLabel: "18m ago",
      },
      {
        id: "lc-2",
        missionId: "m-1",
        agentId: "a-verifier",
        kind: "reviewing",
        summary: "Verifier activated after the diff artifact appeared and began preparing review output.",
        createdAtLabel: "8m ago",
      },
      {
        id: "lc-3",
        missionId: "m-1",
        agentId: "a-builder-2",
        kind: "blocked",
        summary: "Builder-2 was parked behind a blocker after the fixture-path event arrived.",
        createdAtLabel: "3m ago",
      },
    ],
  },
  autopilotHandledEventIdsByRunId: {},
  wakeupRequestsByMissionId: {},
  executionAttemptsByRunId: {},
  sessionLeasesByWorkspaceId: {},
};

export function cloneSeed(): RuntimeState {
  return JSON.parse(JSON.stringify(seedState)) as RuntimeState;
}
