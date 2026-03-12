import { useEffect, useState } from "react";
import type {
  AppScreen,
  DecisionRecord,
  MissionDetail,
  NavigationItem,
  MissionSnapshot,
  RunAutopilotResult,
  RunDetail,
  ShellSnapshot,
  RuntimeUpdateEvent,
  WorkspaceSummary,
} from "@shared/contracts";

const screenCopy: Record<
  AppScreen,
  { eyebrow: string; title: string; body: string }
> = {
  home: {
    eyebrow: "Launch Surface",
    title: "Start from missions, not files.",
    body:
      "Open a workspace, launch a mission, or spin up a reusable org template. Home is a launcher, not a dashboard.",
  },
  "command-center": {
    eyebrow: "Main Console",
    title: "See the whole agent org in one glance.",
    body:
      "Track active agents, blocked work, review queues, and mission pressure. This is the default operating surface.",
  },
  mission: {
    eyebrow: "Goal Definition",
    title: "Shape the mission before execution starts.",
    body:
      "Capture goals, constraints, success criteria, and the team structure that should attack the work.",
  },
  run: {
    eyebrow: "Execution Inspection",
    title: "Inspect a run like a control room, not a terminal dump.",
    body:
      "Timeline, terminal, diff, artifacts, and decisions are presented as observation surfaces for brief steering.",
  },
  memory: {
    eyebrow: "Operational Memory",
    title: "Recall decisions and patterns worth reusing.",
    body:
      "Memory is where past missions, reusable templates, and failure lessons become live context for the current run.",
  },
  settings: {
    eyebrow: "Environment",
    title: "Tune the system without flooding the product surface.",
    body:
      "Settings stay secondary. Provider selection, defaults, and notifications live here instead of polluting core workflows.",
  },
};

function App() {
  const [version, setVersion] = useState("...");
  const [navigation, setNavigation] = useState<NavigationItem[]>([]);
  const [snapshot, setSnapshot] = useState<ShellSnapshot | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [missions, setMissions] = useState<MissionSnapshot[]>([]);
  const [activeMission, setActiveMission] = useState<MissionDetail | null>(null);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [missionRuns, setMissionRuns] = useState<RunDetail[]>([]);
  const [activeScreen, setActiveScreen] =
    useState<AppScreen>("command-center");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [steeringInput, setSteeringInput] = useState("");
  const [autopilotResult, setAutopilotResult] = useState<RunAutopilotResult>({
    run: null,
    eventKind: "none",
    decision: "observe",
    summary: "Autopilot is waiting for the next run event.",
  });

  async function refresh() {
    const [
      nextNavigation,
      nextSnapshot,
      nextWorkspaces,
      nextMissions,
      nextVersion,
      nextActiveMission,
      nextActiveRun,
      nextMissionRuns,
    ] =
      await Promise.all([
        window.ucm.navigation.listScreens(),
        window.ucm.shell.getSnapshot(),
        window.ucm.workspace.list(),
        window.ucm.mission.list(),
        window.ucm.app.getVersion(),
        window.ucm.mission.getActive(),
        window.ucm.run.getActive(),
        window.ucm.run.listForActiveMission(),
      ]);
    setNavigation(nextNavigation);
    setSnapshot(nextSnapshot);
    setWorkspaces(nextWorkspaces);
    setMissions(nextMissions);
    setVersion(nextVersion);
    setActiveMission(nextActiveMission);
    setActiveRun(nextActiveRun);
    setMissionRuns(nextMissionRuns);
  }

  useEffect(() => {
    void refresh();
    const unsubscribe = window.ucm.events.onRuntimeUpdate(
      (_event: RuntimeUpdateEvent) => {
        void refresh();
      },
    );
    void window.ucm.run.autopilotBurst({ maxSteps: 4 }).then((result) => {
      setAutopilotResult(result.lastResult);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!activeRun?.terminalSessionId) {
      return;
    }
    void window.ucm.run.terminalResize({
      sessionId: activeRun.terminalSessionId,
      cols: 120,
      rows: 32,
    });
  }, [activeRun?.terminalSessionId]);

  async function handleCreateMission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeWorkspace = workspaces.find((workspace) => workspace.active);
    if (!activeWorkspace || !title.trim() || !goal.trim()) return;
    await window.ucm.mission.create({
      workspaceId: activeWorkspace.id,
      title,
      goal,
    });
    setTitle("");
    setGoal("");
    setActiveScreen("command-center");
    void window.ucm.app.getVersion().then(setVersion);
    await refresh();
  }

  async function handleSteeringSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeRun?.id || !steeringInput.trim()) {
      return;
    }
    await window.ucm.run.steeringSubmit({
      runId: activeRun.id,
      text: steeringInput,
    });
    setSteeringInput("");
  }

  async function handleTerminalStop() {
    if (!activeRun?.terminalSessionId) {
      return;
    }
    await window.ucm.run.terminalKill({
      sessionId: activeRun.terminalSessionId,
    });
  }

  async function handleApproveRevision(revisionId: string) {
    if (!activeRun?.id) {
      return;
    }
    await window.ucm.deliverable.approve({
      runId: activeRun.id,
      deliverableRevisionId: revisionId,
    });
  }

  const current = screenCopy[activeScreen];
  const selectedMissionTitle = activeMission?.title ?? snapshot?.missionName ?? "No mission";
  const recentRunEvents = [...(activeRun?.runEvents ?? [])].reverse();
  const latestEventByAgentId = new Map(
    recentRunEvents
      .filter((event) => event.agentId)
      .map((event) => [event.agentId as string, event]),
  );
  const latestSteeringRequest =
    recentRunEvents.find((event) => event.kind === "steering_requested") ?? null;
  const steeringEvents = recentRunEvents.filter(
    (event) => event.kind === "steering_submitted",
  );
  const activeSteeringEvents = steeringEvents.filter(
    (event) => event.metadata?.status === "active",
  );
  const archivedSteeringEvents = steeringEvents.filter(
    (event) => event.metadata?.status === "resolved" || event.metadata?.status === "superseded",
  );
  const latestApprovalPacket =
    activeRun?.deliverables[0]?.revisions.find(
      (revision) =>
        revision.id === activeRun.deliverables[0]?.latestRevisionId,
    ) ?? null;
  const activeApprovalPackets =
    activeRun?.deliverables.flatMap((deliverable) =>
      deliverable.revisions.filter((revision) => revision.status === "active"),
    ) ?? [];
  const archivedApprovalPackets =
    activeRun?.deliverables.flatMap((deliverable) =>
      deliverable.revisions.filter((revision) => revision.status !== "active"),
    ) ?? [];
  const recentApprovalHandoffs = (activeRun?.handoffs ?? [])
    .filter((handoff) => handoff.status === "active")
    .slice(-3)
    .reverse();
  const archivedApprovalHandoffs = (activeRun?.handoffs ?? [])
    .filter((handoff) => handoff.status !== "active")
    .slice(-3)
    .reverse();
  const activeRunBudgetLabel = activeRun?.budgetClass
    ? `${activeRun.budgetClass} budget`
    : activeRun?.origin?.budgetClass
      ? `${activeRun.origin.budgetClass} budget`
      : "default budget";
  const activeProviderLabel = activeRun?.providerPreference
    ? `${activeRun.providerPreference} window`
    : "provider window";
  const providerSummary =
    (snapshot?.providerWindows ?? [])
      .map((windowInfo) => `${windowInfo.provider}:${windowInfo.status}`)
      .join(" • ") || "loading";
  const parentRunIds = new Set(
    missionRuns
      .map((run) => run.origin?.parentRunId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  const rootRuns = missionRuns.filter((run) => !run.origin?.parentRunId);
  const followupRuns = missionRuns.filter((run) => Boolean(run.origin?.parentRunId));

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">UCM Agent IDE</p>
          <h1>{snapshot?.workspaceName ?? "Loading workspace..."}</h1>
        </div>
        <div className="topbar-metrics">
          <Metric label="Mission" value={snapshot?.missionName ?? "Loading"} />
          <Metric label="Providers" value={providerSummary} />
          <Metric label="Agents" value={String(snapshot?.activeAgents ?? 0)} />
          <Metric
            label="Blocked"
            value={String(snapshot?.blockedAgents ?? 0)}
          />
          <Metric label="Review" value={String(snapshot?.reviewCount ?? 0)} />
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-card">
            <p className="section-label">Navigation</p>
            <nav className="nav-list">
              {navigation.map((item) => (
                <button
                  className={
                    item.id === activeScreen ? "nav-item active" : "nav-item"
                  }
                  key={item.id}
                  onClick={() => setActiveScreen(item.id)}
                  type="button"
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar-card">
            <p className="section-label">Workspaces</p>
            <div className="stack-list">
              {workspaces.map((workspace) => (
                <div className="stack-card" key={workspace.id}>
                  <strong>{workspace.name}</strong>
                  <span className={`status ${workspace.active ? "status-running" : "status-queued"}`}>
                    {workspace.active ? "active" : "available"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="main-surface">
          <section className="hero-card">
            <p className="eyebrow">{current.eyebrow}</p>
            <h2>{current.title}</h2>
            <p>{current.body}</p>
          </section>

          <section className="content-grid">
            <div className="panel org-panel">
              <div className="panel-head">
                <h3>
                  {activeScreen === "home"
                    ? "Mission Launcher"
                    : activeScreen === "mission"
                      ? selectedMissionTitle
                      : activeScreen === "run"
                        ? activeRun?.title ?? "Run"
                        : "Agent Org"}
                </h3>
                <span>
                  {activeScreen === "home"
                    ? `${missions.length} missions`
                    : activeScreen === "mission"
                      ? `${activeMission?.phases.length ?? 0} phases`
                      : activeScreen === "run"
                        ? `${activeRun?.runEvents.length ?? 0} run events`
                    : `${snapshot?.agents.length ?? 0} team members`}
                </span>
              </div>
              {activeScreen === "home" ? (
                <div className="launcher-grid">
                  <form className="mission-form" onSubmit={handleCreateMission}>
                    <label>
                      Mission title
                      <input
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Checkout auth regression fix"
                        value={title}
                      />
                    </label>
                    <label>
                      Goal
                      <textarea
                        onChange={(event) => setGoal(event.target.value)}
                        placeholder="Restore checkout stability without breaking auth flow."
                        rows={4}
                        value={goal}
                      />
                    </label>
                    <button className="primary-button" type="submit">
                      Create Mission
                    </button>
                  </form>

                  <div className="stack-list">
                    {missions.map((mission) => (
                      <div className="stack-card" key={mission.id}>
                        <strong>{mission.title}</strong>
                        <span className={`status status-${mission.status}`}>
                          {mission.status}
                        </span>
                        {mission.goal ? <p className="stack-copy">{mission.goal}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : activeScreen === "mission" ? (
                <div className="mission-detail-grid">
                  <section className="detail-block">
                    <p className="section-label">Goal</p>
                    <h4>{activeMission?.goal ?? "No active mission selected."}</h4>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Success Criteria</p>
                    <ul className="principles">
                      {(activeMission?.successCriteria ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Constraints</p>
                    <ul className="principles">
                      {(activeMission?.constraints ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Plan Phases</p>
                    <div className="stack-list">
                      {(activeMission?.phases ?? []).map((phase) => (
                        <div className="stack-card" key={phase.id}>
                          <strong>{phase.title}</strong>
                          <span className={`status status-${phase.status === "active" ? "running" : phase.status === "done" ? "review" : "queued"}`}>
                            {phase.status}
                          </span>
                          <p className="stack-copy">{phase.objective}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : activeScreen === "run" ? (
                <div className="run-detail-grid">
                  <section className="detail-block">
                    <p className="section-label">Mission Pressure</p>
                    <div className="stack-list">
                      <div className="stack-card">
                        <strong>Event-driven delivery loop</strong>
                        <span className="status status-running">
                          {autopilotResult.decision === "observe"
                            ? "watching"
                            : autopilotResult.decision}
                        </span>
                        <p className="stack-copy">
                          {autopilotResult.summary}
                        </p>
                        <p className="stack-copy">
                          Last event: {autopilotResult.eventKind}
                        </p>
                        <p className="stack-copy">Run budget: {activeRunBudgetLabel}</p>
                      </div>
                      <div className="stack-card">
                        <strong>Provider Windows</strong>
                        <span className="status status-review">
                          {activeProviderLabel}
                        </span>
                        <div className="revision-list">
                          {(snapshot?.providerWindows ?? []).map((windowInfo) => (
                            <div className="revision-item" key={windowInfo.provider}>
                              <strong>{windowInfo.provider}</strong>
                              <span>
                                {windowInfo.status} • {windowInfo.activeRuns} active • {windowInfo.queuedRuns} queued
                              </span>
                              <p>
                                Next slot: {windowInfo.nextAvailableLabel}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Steering Inbox</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>Brief Steering</strong>
                        <span className="status status-review">
                          {activeSteeringEvents.length > 0
                            ? `${activeSteeringEvents.length} active`
                            : latestSteeringRequest
                              ? "requested"
                              : "quiet"}
                        </span>
                        <p className="stack-copy">
                          {activeSteeringEvents[0]?.metadata?.steering ??
                            latestSteeringRequest?.summary ??
                            "No steering request is active. Humans should stay out of the loop unless the conductor asks for it."}
                        </p>
                        <form className="mission-form" onSubmit={handleSteeringSubmit}>
                          <label>
                            Submit steering
                            <input
                              onChange={(event) => setSteeringInput(event.target.value)}
                              placeholder="Use the fallback fixture from the checkout regression suite."
                              value={steeringInput}
                            />
                          </label>
                          <button
                            className="primary-button"
                            disabled={!activeRun?.id || !steeringInput.trim()}
                            type="submit"
                          >
                            Send Steering
                          </button>
                        </form>
                      </div>
                      {activeSteeringEvents.length > 0 ? (
                        <div className="stack-list">
                          {activeSteeringEvents.map((event) => (
                            <div className="stack-card" key={event.id}>
                              <strong>Active Steering</strong>
                              <span className="status status-running">
                                {event.metadata?.status ?? "active"}
                              </span>
                              <p className="stack-copy">
                                {event.metadata?.steering ?? event.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {archivedSteeringEvents.length > 0 ? (
                        <div className="stack-list">
                          {archivedSteeringEvents.slice(0, 3).map((event) => (
                            <div className="stack-card" key={event.id}>
                              <strong>Steering History</strong>
                              <span
                                className={`status ${
                                  event.metadata?.status === "resolved"
                                    ? "status-running"
                                    : "status-queued"
                                }`}
                              >
                                {event.metadata?.status ?? "archived"}
                              </span>
                              <p className="stack-copy">
                                {event.metadata?.steering ?? event.summary}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Approval Queue</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>Approval Packet</strong>
                        <span className="status status-running">
                          {activeApprovalPackets.length > 0
                            ? `${activeApprovalPackets.length} active`
                            : latestApprovalPacket?.status ?? "pending"}
                        </span>
                        <p className="stack-copy">
                          {latestApprovalPacket?.summary ??
                            "No reviewer-facing packet is ready yet."}
                        </p>
                        <button
                          className="primary-button"
                          disabled={!latestApprovalPacket || latestApprovalPacket.status !== "active"}
                          onClick={() => {
                            if (latestApprovalPacket) {
                              void handleApproveRevision(latestApprovalPacket.id);
                            }
                          }}
                          type="button"
                        >
                          Approve Latest
                        </button>
                      </div>
                      {activeApprovalPackets.length > 0 ? (
                        <div className="stack-list">
                          {activeApprovalPackets.map((revision) => (
                            <div className="stack-card" key={revision.id}>
                              <strong>Active Review</strong>
                              <span className="status status-review">
                                {revision.status}
                              </span>
                              <p className="stack-copy">{revision.summary}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="stack-list">
                        {recentApprovalHandoffs.map((handoff) => (
                          <div className="stack-card" key={handoff.id}>
                            <strong>{handoff.channel}</strong>
                            <span className="status status-review">{handoff.status}</span>
                            <p className="stack-copy">
                              Revision {handoff.deliverableRevisionId}
                              {handoff.target ? ` to ${handoff.target}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                      {archivedApprovalPackets.length > 0 || archivedApprovalHandoffs.length > 0 ? (
                        <div className="stack-list">
                          {archivedApprovalPackets.slice(0, 3).map((revision) => (
                            <div className="stack-card" key={revision.id}>
                              <strong>Approval History</strong>
                              <span
                                className={`status ${
                                  revision.status === "approved"
                                    ? "status-running"
                                    : "status-queued"
                                }`}
                              >
                                {revision.status}
                              </span>
                              <p className="stack-copy">{revision.summary}</p>
                            </div>
                          ))}
                          {archivedApprovalHandoffs.map((handoff) => (
                            <div className="stack-card" key={handoff.id}>
                              <strong>Handoff History</strong>
                              <span
                                className={`status ${
                                  handoff.status === "approved"
                                    ? "status-running"
                                    : "status-queued"
                                }`}
                              >
                                {handoff.status}
                              </span>
                              <p className="stack-copy">
                                Revision {handoff.deliverableRevisionId}
                                {handoff.target ? ` to ${handoff.target}` : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Emergency Stop</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>Emergency Stop</strong>
                        <span className="status status-blocked">
                          {activeRun?.terminalSessionId ? "armed" : "idle"}
                        </span>
                        <p className="stack-copy">
                          Stop is the only direct terminal intervention exposed in the default surface.
                        </p>
                        <button
                          className="primary-button"
                          disabled={!activeRun?.terminalSessionId}
                          onClick={() => {
                            void handleTerminalStop();
                          }}
                          type="button"
                        >
                          Stop Session
                        </button>
                      </div>
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Execution Trace</p>
                    <div className="timeline-list">
                      {(activeRun?.runEvents ?? []).map((event) => (
                        <div className="timeline-item" key={event.id}>
                          <strong>{event.summary}</strong>
                          <span>
                            {event.kind}
                            {event.agentId ? ` • ${event.agentId}` : ""}
                            {event.metadata?.budgetClass
                              ? ` • ${event.metadata.budgetClass} budget`
                              : ""}
                            {` • ${event.createdAtLabel}`}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="timeline-list">
                      {(activeRun?.timeline ?? []).map((entry) => (
                        <div className="timeline-item" key={entry.id}>
                          <strong>{entry.summary}</strong>
                          <span>{entry.timestampLabel}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Terminal Trace</p>
                    <div className="stack-card">
                      <strong>
                        {activeRun?.terminalProvider
                          ? `${activeRun.terminalProvider} session`
                          : "No live terminal"}
                      </strong>
                      <span className="status status-running">
                        {activeRun?.terminalSessionId ?? "offline"}
                      </span>
                      <p className="stack-copy">
                        Terminal is observation-first. Human guidance goes through brief steering, not raw PTY input.
                      </p>
                    </div>
                    <pre className="terminal-preview">
                      {(activeRun?.terminalPreview ?? []).join("\n")}
                    </pre>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Artifact Trace</p>
                    <div className="stack-list">
                      {(activeRun?.artifacts ?? []).map((artifact) => (
                        <div className="stack-card" key={artifact.id}>
                          <strong>{artifact.title}</strong>
                          <span className="status status-review">{artifact.type}</span>
                          <p className="stack-copy">{artifact.preview}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Deliverable History</p>
                    <div className="stack-list">
                      {(activeRun?.deliverables ?? []).map((deliverable) => (
                        <div className="stack-card" key={deliverable.id}>
                          <strong>{deliverable.title}</strong>
                          <span className="status status-review">
                            {deliverable.kind}
                          </span>
                          <p className="stack-copy">
                            Latest revision:{" "}
                            {
                              deliverable.revisions.find(
                                (revision) =>
                                  revision.id === deliverable.latestRevisionId,
                              )?.summary
                            }
                          </p>
                          {activeRun?.origin?.schedulerRuleId ? (
                            <p className="stack-copy">
                              Rule: {activeRun.origin.schedulerRuleId} • {activeRunBudgetLabel} • {activeProviderLabel}
                            </p>
                          ) : null}
                          <div className="revision-list">
                            {deliverable.revisions.map((revision) => (
                              <div className="revision-item" key={revision.id}>
                                <strong>v{revision.revision}</strong>
                                <span>{revision.createdAtLabel} • {revision.status}</span>
                                <p>{revision.summary}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="command-center-grid">
                  <section className="detail-block">
                    <p className="section-label">Agent Org</p>
                    <div className="org-grid">
                      {snapshot?.agents.map((agent) => (
                        <article className="agent-card" key={agent.id}>
                          <div className="agent-head">
                            <strong>{agent.name}</strong>
                            <span className={`badge badge-${agent.status}`}>
                              {agent.status}
                            </span>
                          </div>
                          <p className="agent-role">{agent.role}</p>
                          <p className="agent-objective">{agent.objective}</p>
                          {latestEventByAgentId.get(agent.id) ? (
                            <div className="agent-event">
                              <strong>
                                {latestEventByAgentId.get(agent.id)?.kind}
                              </strong>
                              <p>
                                {latestEventByAgentId.get(agent.id)?.summary}
                              </p>
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">Run Graph</p>
                    <div className="run-graph-list">
                      {rootRuns.map((run) => (
                        <div className="run-graph-node root" key={run.id}>
                          <div className="run-graph-head">
                            <strong>{run.title}</strong>
                            <span className={`status status-${run.status === "running" ? "running" : run.status === "queued" ? "queued" : run.status === "blocked" ? "blocked" : "review"}`}>
                              {run.status}
                            </span>
                          </div>
                          <p className="stack-copy">
                            {run.providerPreference ?? "provider"} • {run.budgetClass ?? "default"} • {run.id}
                          </p>
                          <p className="stack-copy">{run.summary}</p>
                          {parentRunIds.has(run.id) ? (
                            <div className="run-children">
                              {followupRuns
                                .filter((child) => child.origin?.parentRunId === run.id)
                                .map((child) => (
                                  <div className="run-graph-node child" key={child.id}>
                                    <div className="run-graph-head">
                                      <strong>{child.title}</strong>
                                      <span className={`status status-${child.status === "running" ? "running" : child.status === "queued" ? "queued" : child.status === "blocked" ? "blocked" : "review"}`}>
                                        {child.status}
                                      </span>
                                    </div>
                                    <p className="stack-copy">
                                      {child.providerPreference ?? "provider"} • {child.origin?.schedulerRuleId ?? "manual"} • {child.id}
                                    </p>
                                    <p className="stack-copy">
                                      {child.status === "queued"
                                        ? "Waiting for provider capacity before execution resumes."
                                        : child.summary}
                                    </p>
                                  </div>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </div>

            <div className="panel inspector-panel">
              <div className="panel-head">
                <h3>
                  {activeScreen === "home"
                    ? "Mission Notes"
                    : activeScreen === "mission"
                      ? "Mission Risks"
                      : activeScreen === "run"
                        ? "Review Log"
                        : "Lifecycle Queue"}
                </h3>
                <span>v{version}</span>
              </div>
              {activeScreen === "home" ? (
                <ul className="principles">
                  <li>Start from a workspace and a mission, not from files.</li>
                  <li>Mission creation now persists through the Electron runtime service.</li>
                  <li>New missions immediately become the active command-center context.</li>
                </ul>
              ) : activeScreen === "mission" ? (
                <ul className="principles">
                  {(activeMission?.risks ?? []).map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : activeScreen === "run" ? (
                <div className="stack-list">
                  {(activeRun?.decisions ?? []).map((decision) => (
                    <DecisionCard decision={decision} key={decision.id} />
                  ))}
                </div>
              ) : (
                <div className="stack-list">
                  {(snapshot?.lifecycleEvents ?? []).map((event) => (
                    <div className="stack-card" key={event.id}>
                      <strong>{event.summary}</strong>
                      <span className="status status-review">{event.kind}</span>
                      <p className="stack-copy">
                        {event.agentId} • {event.createdAtLabel}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="inspector-box">
                <p className="section-label">Next Implementation Step</p>
                <p>
                  {activeScreen === "home"
                    ? "Replace the mission launcher form with the richer Mission view flow from the wireframe spec."
                    : activeScreen === "mission"
                      ? "Promote plan editing and team structure assignment into dedicated mission actions."
                      : activeScreen === "run"
                        ? "Wire brief steering, approval, and emergency stop into real runtime commands while keeping revision generation fully automatic."
                    : "Replace the current runtime JSON store with separated mission, policy, and execution services before the execution loop lands."}
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DecisionCard({ decision }: { decision: DecisionRecord }) {
  return (
    <div className="stack-card">
      <strong>{decision.summary}</strong>
      <span className="status status-review">{decision.category}</span>
      <p className="stack-copy">{decision.rationale}</p>
    </div>
  );
}

export default App;
