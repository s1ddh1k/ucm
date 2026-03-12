import { useEffect, useState } from "react";
import type {
  AppScreen,
  ArtifactRecord,
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

type Locale = "ko" | "en";

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
    eyebrow: "Workbench",
    title: "Inspect code, tests, and artifacts in one work surface.",
    body:
      "The workbench turns a run into a code-facing surface: changed files, patch shape, tests, and steering stay visible together.",
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

const messages = {
  ko: {
    nav: {
      home: { label: "홈", description: "워크스페이스, 미션, 템플릿 시작" },
      "command-center": { label: "커맨드 센터", description: "에이전트 팀과 병목, 실행 현황" },
      mission: { label: "미션", description: "목표, 제약, 계획, 팀 구조" },
      run: { label: "워크벤치", description: "코드, 테스트, 산출물 작업면" },
      memory: { label: "메모리", description: "이전 미션, 결정, 재사용 패턴" },
      settings: { label: "설정", description: "프로바이더와 기본 동작 설정" },
    },
    screen: {
      home: {
        eyebrow: "시작 화면",
        title: "파일이 아니라 미션에서 시작합니다.",
        body: "워크스페이스를 열고, 미션을 만들고, 재사용 가능한 템플릿을 고릅니다. 홈은 런처이지 대시보드가 아닙니다.",
      },
      "command-center": {
        eyebrow: "메인 콘솔",
        title: "에이전트 조직 전체를 한눈에 봅니다.",
        body: "활성 에이전트, 막힌 작업, 리뷰 대기열, 미션 압력을 한 화면에서 봅니다.",
      },
      mission: {
        eyebrow: "목표 정의",
        title: "실행 전에 미션을 정리합니다.",
        body: "목표, 제약, 성공 기준, 팀 구조를 먼저 정리합니다.",
      },
      run: {
        eyebrow: "워크벤치",
        title: "코드, 테스트, 산출물을 한 작업면에서 봅니다.",
        body: "워크벤치는 실행을 코드 중심 표면으로 바꿉니다. 변경 파일, 패치 형태, 테스트, 스티어링을 같이 둡니다.",
      },
      memory: {
        eyebrow: "운영 메모리",
        title: "재사용할 결정과 패턴을 다시 불러옵니다.",
        body: "메모리는 과거 미션과 실패 사례를 현재 실행 컨텍스트로 끌어옵니다.",
      },
      settings: {
        eyebrow: "환경",
        title: "핵심 화면을 어지럽히지 않고 시스템을 조정합니다.",
        body: "설정은 보조 레이어에 둡니다. 프로바이더 선택과 기본값, 알림은 여기서 다룹니다.",
      },
    },
    topbar: { mission: "미션", providers: "프로바이더", agents: "에이전트", blocked: "막힘", review: "리뷰" },
    common: {
      loadingWorkspace: "워크스페이스 불러오는 중...",
      loading: "불러오는 중",
      navigation: "탐색",
      workspaces: "워크스페이스",
      active: "active",
      available: "available",
      teamMembers: "팀 멤버",
      phases: "단계",
      runEvents: "실행 이벤트",
      missions: "미션",
      language: "언어",
      korean: "한국어",
      english: "영어",
    },
    sections: {
      missionLauncher: "미션 시작",
      agentOrg: "에이전트 조직",
      runGraph: "실행 그래프",
      goal: "목표",
      successCriteria: "성공 기준",
      constraints: "제약",
      planPhases: "계획 단계",
      changedFiles: "변경 파일",
      patchSurface: "패치 표면",
      testAndDelivery: "테스트 + 전달",
      runLineage: "실행 계보",
      missionPressure: "미션 압력",
      providerWindows: "프로바이더 창",
      steeringInbox: "스티어링 인박스",
      approvalQueue: "승인 대기열",
      emergencyStop: "긴급 중지",
      executionTrace: "실행 추적",
      terminalTrace: "터미널 추적",
      artifactTrace: "산출물 추적",
      deliverableHistory: "전달물 이력",
      missionNotes: "미션 노트",
      missionRisks: "미션 리스크",
      reviewLog: "리뷰 로그",
      lifecycleQueue: "라이프사이클 큐",
    },
    labels: {
      currentRun: "현재 실행",
      parentRun: "부모 실행",
      childRun: "자식 실행",
      verificationSignal: "검증 신호",
      latestDecision: "최신 결정",
      deliveryPacket: "전달 패킷",
      briefSteering: "짧은 스티어링",
      activeSteering: "활성 스티어링",
      steeringHistory: "스티어링 이력",
      approvalPacket: "승인 패킷",
      activeReview: "활성 리뷰",
      approvalHistory: "승인 이력",
      handoffHistory: "전달 이력",
      eventDrivenLoop: "이벤트 기반 전달 루프",
      noLiveTerminal: "실시간 터미널 없음",
      noPatchYet: "아직 패치 없음",
      noChangedFiles: "아직 변경 파일 없음",
      noDiffPreview: "아직 diff preview가 없습니다.",
      noTestArtifact: "아직 테스트 결과 산출물이 없습니다.",
      noDecision: "아직 결정 요약이 없습니다.",
      noDeliverable: "아직 활성 전달물 리비전이 없습니다.",
    },
    actions: {
      createMission: "미션 생성",
      submitSteering: "스티어링 전달",
      approveLatest: "최신본 승인",
      stopSession: "세션 중지",
    },
  },
  en: {
    nav: {
      home: { label: "Home", description: "Launch workspaces, missions, and templates" },
      "command-center": { label: "Command Center", description: "Agent teams, bottlenecks, and live runs" },
      mission: { label: "Mission", description: "Goals, constraints, plan, and team shape" },
      run: { label: "Workbench", description: "Code, tests, and artifact work surface" },
      memory: { label: "Memory", description: "Past missions, decisions, and reusable patterns" },
      settings: { label: "Settings", description: "Providers and runtime defaults" },
    },
    screen: screenCopy,
    topbar: { mission: "Mission", providers: "Providers", agents: "Agents", blocked: "Blocked", review: "Review" },
    common: {
      loadingWorkspace: "Loading workspace...",
      loading: "Loading",
      navigation: "Navigation",
      workspaces: "Workspaces",
      active: "active",
      available: "available",
      teamMembers: "team members",
      phases: "phases",
      runEvents: "run events",
      missions: "missions",
      language: "Language",
      korean: "Korean",
      english: "English",
    },
    sections: {
      missionLauncher: "Mission Launcher",
      agentOrg: "Agent Org",
      runGraph: "Run Graph",
      goal: "Goal",
      successCriteria: "Success Criteria",
      constraints: "Constraints",
      planPhases: "Plan Phases",
      changedFiles: "Changed Files",
      patchSurface: "Patch Surface",
      testAndDelivery: "Test + Delivery",
      runLineage: "Run Lineage",
      missionPressure: "Mission Pressure",
      providerWindows: "Provider Windows",
      steeringInbox: "Steering Inbox",
      approvalQueue: "Approval Queue",
      emergencyStop: "Emergency Stop",
      executionTrace: "Execution Trace",
      terminalTrace: "Terminal Trace",
      artifactTrace: "Artifact Trace",
      deliverableHistory: "Deliverable History",
      missionNotes: "Mission Notes",
      missionRisks: "Mission Risks",
      reviewLog: "Review Log",
      lifecycleQueue: "Lifecycle Queue",
    },
    labels: {
      currentRun: "Current Run",
      parentRun: "Parent Run",
      childRun: "Child Run",
      verificationSignal: "Verification Signal",
      latestDecision: "Latest Decision",
      deliveryPacket: "Delivery Packet",
      briefSteering: "Brief Steering",
      activeSteering: "Active Steering",
      steeringHistory: "Steering History",
      approvalPacket: "Approval Packet",
      activeReview: "Active Review",
      approvalHistory: "Approval History",
      handoffHistory: "Handoff History",
      eventDrivenLoop: "Event-driven delivery loop",
      noLiveTerminal: "No live terminal",
      noPatchYet: "No patch emitted yet",
      noChangedFiles: "No changed files yet",
      noDiffPreview: "No diff preview is available yet.",
      noTestArtifact: "No test result artifact is attached to this run yet.",
      noDecision: "No decision summary available.",
      noDeliverable: "No deliverable revision is active.",
    },
    actions: {
      createMission: "Create Mission",
      submitSteering: "Send Steering",
      approveLatest: "Approve Latest",
      stopSession: "Stop Session",
    },
  },
} as const;

function App() {
  const [version, setVersion] = useState("...");
  const [navigation, setNavigation] = useState<NavigationItem[]>([]);
  const [snapshot, setSnapshot] = useState<ShellSnapshot | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [missions, setMissions] = useState<MissionSnapshot[]>([]);
  const [activeMission, setActiveMission] = useState<MissionDetail | null>(null);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [missionRuns, setMissionRuns] = useState<RunDetail[]>([]);
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof window === "undefined") return "ko";
    return (window.localStorage.getItem("ucm-locale") as Locale | null) ?? "ko";
  });
  const [activeScreen, setActiveScreen] =
    useState<AppScreen>("command-center");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [steeringInput, setSteeringInput] = useState("");
  const [selectedPatchPath, setSelectedPatchPath] = useState<string | null>(null);
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
    window.localStorage.setItem("ucm-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

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

  useEffect(() => {
    setSelectedPatchPath(null);
  }, [activeRun?.id]);

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

  async function handleSelectRun(runId: string) {
    await window.ucm.run.setActive({ runId });
    setActiveScreen("run");
    await refresh();
  }

  const current = messages[locale].screen[activeScreen];
  const navCopy = messages[locale].nav;
  const ui = messages[locale];
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
    ? locale === "ko"
      ? `${activeRun.budgetClass} 버짓`
      : `${activeRun.budgetClass} budget`
    : activeRun?.origin?.budgetClass
      ? locale === "ko"
        ? `${activeRun.origin.budgetClass} 버짓`
        : `${activeRun.origin.budgetClass} budget`
      : locale === "ko"
        ? "기본 버짓"
        : "default budget";
  const activeProviderLabel = activeRun?.providerPreference
    ? locale === "ko"
      ? `${activeRun.providerPreference} 창`
      : `${activeRun.providerPreference} window`
    : locale === "ko"
      ? "프로바이더 창"
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
  const activeRunParent =
    activeRun?.origin?.parentRunId
      ? missionRuns.find((run) => run.id === activeRun.origin?.parentRunId) ?? null
      : null;
  const activeRunChildren = missionRuns.filter(
    (run) => run.origin?.parentRunId === activeRun?.id,
  );
  const changedFiles = (activeRun?.artifacts ?? [])
    .filter((artifact) => artifact.type === "diff")
    .flatMap((artifact) => getChangedFilesForArtifact(artifact));
  const testArtifacts = (activeRun?.artifacts ?? []).filter(
    (artifact) => artifact.type === "test_result",
  );
  const diffArtifact =
    (activeRun?.artifacts ?? []).find((artifact) => artifact.type === "diff") ?? null;
  const diffFilePatches = diffArtifact ? getFilePatchesForArtifact(diffArtifact) : [];
  const selectedPatch =
    diffFilePatches.find((patch) => patch.path === selectedPatchPath) ??
    diffFilePatches[0] ??
    null;
  const primaryDecision = activeRun?.decisions.at(-1) ?? null;
  const primaryDeliverable = activeRun?.deliverables[0] ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">UCM Agent IDE</p>
          <h1>{snapshot?.workspaceName ?? ui.common.loadingWorkspace}</h1>
        </div>
        <div className="topbar-metrics">
          <Metric label={ui.topbar.mission} value={snapshot?.missionName ?? ui.common.loading} />
          <Metric label={ui.topbar.providers} value={providerSummary} />
          <Metric label={ui.topbar.agents} value={String(snapshot?.activeAgents ?? 0)} />
          <Metric
            label={ui.topbar.blocked}
            value={String(snapshot?.blockedAgents ?? 0)}
          />
          <Metric label={ui.topbar.review} value={String(snapshot?.reviewCount ?? 0)} />
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-card">
            <p className="section-label">{ui.common.navigation}</p>
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
                  <span>{navCopy[item.id].label}</span>
                  <small>{navCopy[item.id].description}</small>
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar-card">
            <p className="section-label">{ui.common.workspaces}</p>
            <div className="stack-list">
              <div className="stack-card">
                <strong>{ui.common.language}</strong>
                <div className="action-stack">
                  <button className="primary-button" onClick={() => setLocale("ko")} type="button">
                    {ui.common.korean}
                  </button>
                  <button className="primary-button" onClick={() => setLocale("en")} type="button">
                    {ui.common.english}
                  </button>
                </div>
              </div>
            </div>
            <div className="stack-list">
              {workspaces.map((workspace) => (
                <div className="stack-card" key={workspace.id}>
                  <strong>{workspace.name}</strong>
                  <span className={`status ${workspace.active ? "status-running" : "status-queued"}`}>
                    {workspace.active ? ui.common.active : ui.common.available}
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
                      ? `${activeMission?.phases.length ?? 0} ${ui.common.phases}`
                      : activeScreen === "run"
                        ? `${activeRun?.runEvents.length ?? 0} ${ui.common.runEvents}`
                    : `${snapshot?.agents.length ?? 0} ${ui.common.teamMembers}`}
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
                      {ui.actions.createMission}
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
                    <p className="section-label">{ui.sections.goal}</p>
                    <h4>{activeMission?.goal ?? "No active mission selected."}</h4>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.successCriteria}</p>
                    <ul className="principles">
                      {(activeMission?.successCriteria ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.constraints}</p>
                    <ul className="principles">
                      {(activeMission?.constraints ?? []).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.planPhases}</p>
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
                <div className="workbench-grid">
                  <section className="detail-block workbench-files">
                    <p className="section-label">{ui.sections.changedFiles}</p>
                    <div className="stack-list">
                      {changedFiles.length > 0 ? (
                        changedFiles.map((filePath) => (
                          <button
                            className={`stack-card file-card ${
                              filePath === selectedPatch?.path ? "selected" : ""
                            }`}
                            key={filePath}
                            onClick={() => setSelectedPatchPath(filePath)}
                            type="button"
                          >
                            <strong>{filePath}</strong>
                            <span className="status status-review">diff</span>
                            <p className="stack-copy">
                              {diffFilePatches.find((patch) => patch.path === filePath)?.summary ??
                                (locale === "ko"
                                  ? "이 파일의 패치 내용을 확인합니다."
                                  : "Inspect the patch emitted for this file.")}
                            </p>
                          </button>
                        ))
                      ) : (
                        <div className="stack-card">
                          <strong>{ui.labels.noChangedFiles}</strong>
                          <p className="stack-copy">
                            {locale === "ko"
                              ? "현재 실행이 아직 코드 diff를 내지 않았습니다."
                              : "The current run has not emitted a code diff yet."}
                          </p>
                        </div>
                      )}
                    </div>
                  </section>
                  <section className="detail-block workbench-diff">
                    <p className="section-label">{ui.sections.patchSurface}</p>
                    <div className="stack-card">
                      <strong>{selectedPatch?.path ?? diffArtifact?.title ?? ui.labels.noPatchYet}</strong>
                      <span className="status status-running">
                        {activeRun?.status ?? "idle"}
                      </span>
                      <p className="stack-copy">
                        {selectedPatch?.summary ??
                          diffArtifact?.preview ??
                          activeRun?.summary ??
                          ui.labels.noDiffPreview}
                      </p>
                    </div>
                    <pre className="terminal-preview workbench-preview" data-testid="patch-surface">
{selectedPatch?.patch ??
  (diffArtifact
    ? buildFallbackPatch(diffArtifact)
    : "// waiting for patch output")}
                    </pre>
                  </section>
                  <section className="detail-block workbench-side">
                    <p className="section-label">{ui.sections.testAndDelivery}</p>
                    <div className="stack-list">
                      <div className="stack-card">
                        <strong>{ui.labels.verificationSignal}</strong>
                        <span className="status status-review">
                          {testArtifacts.length > 0 ? `${testArtifacts.length} test artifacts` : "pending"}
                        </span>
                        <p className="stack-copy">
                          {testArtifacts[0]?.preview ?? ui.labels.noTestArtifact}
                        </p>
                      </div>
                      <div className="stack-card">
                        <strong>{ui.labels.latestDecision}</strong>
                        <span className="status status-queued">
                          {primaryDecision?.category ?? "none"}
                        </span>
                        <p className="stack-copy">
                          {primaryDecision?.summary ?? ui.labels.noDecision}
                        </p>
                      </div>
                      <div className="stack-card">
                        <strong>{ui.labels.deliveryPacket}</strong>
                        <span className="status status-running">
                          {primaryDeliverable?.kind ?? "none"}
                        </span>
                        <p className="stack-copy">
                          {primaryDeliverable?.revisions.find(
                            (revision) => revision.id === primaryDeliverable.latestRevisionId,
                          )?.summary ?? ui.labels.noDeliverable}
                        </p>
                      </div>
                    </div>
                  </section>
                  <div className="run-detail-grid">
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.runLineage}</p>
                    <div className="stack-list">
                      <div className="stack-card">
                        <strong>{ui.labels.currentRun}</strong>
                        <span className="status status-running">
                          {activeRun?.status ?? "unknown"}
                        </span>
                        <p className="stack-copy">
                          {activeRun?.title ?? "No active run selected."}
                        </p>
                        <p className="stack-copy">
                          {activeProviderLabel} • {activeRunBudgetLabel}
                        </p>
                      </div>
                      {activeRunParent ? (
                        <button
                          className="stack-card lineage-button"
                          onClick={() => {
                            void handleSelectRun(activeRunParent.id);
                          }}
                          type="button"
                        >
                          <strong>{ui.labels.parentRun}</strong>
                          <span className="status status-queued">
                            {activeRunParent.status}
                          </span>
                          <p className="stack-copy">{activeRunParent.title}</p>
                        </button>
                      ) : null}
                      {activeRunChildren.length > 0 ? (
                        <div className="stack-list">
                          {activeRunChildren.map((child) => (
                            <button
                              className="stack-card lineage-button"
                              key={child.id}
                              onClick={() => {
                                void handleSelectRun(child.id);
                              }}
                              type="button"
                            >
                              <strong>{ui.labels.childRun}</strong>
                              <span className={`status status-${child.status === "running" ? "running" : child.status === "queued" ? "queued" : child.status === "blocked" ? "blocked" : "review"}`}>
                                {child.status}
                              </span>
                              <p className="stack-copy">{child.title}</p>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.missionPressure}</p>
                    <div className="stack-list">
                      <div className="stack-card">
                        <strong>{ui.labels.eventDrivenLoop}</strong>
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
                        <strong>{ui.sections.providerWindows}</strong>
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
                    <p className="section-label">{ui.sections.steeringInbox}</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>{ui.labels.briefSteering}</strong>
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
                            {ui.labels.briefSteering}
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
                            {ui.actions.submitSteering}
                          </button>
                        </form>
                      </div>
                      {activeSteeringEvents.length > 0 ? (
                        <div className="stack-list">
                          {activeSteeringEvents.map((event) => (
                            <div className="stack-card" key={event.id}>
                              <strong>{ui.labels.activeSteering}</strong>
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
                              <strong>{ui.labels.steeringHistory}</strong>
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
                    <p className="section-label">{ui.sections.approvalQueue}</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>{ui.labels.approvalPacket}</strong>
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
                          {ui.actions.approveLatest}
                        </button>
                      </div>
                      {activeApprovalPackets.length > 0 ? (
                        <div className="stack-list">
                          {activeApprovalPackets.map((revision) => (
                            <div className="stack-card" key={revision.id}>
                              <strong>{ui.labels.activeReview}</strong>
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
                              <strong>{ui.labels.approvalHistory}</strong>
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
                              <strong>{ui.labels.handoffHistory}</strong>
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
                    <p className="section-label">{ui.sections.emergencyStop}</p>
                    <div className="action-stack">
                      <div className="stack-card">
                        <strong>{ui.sections.emergencyStop}</strong>
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
                          {ui.actions.stopSession}
                        </button>
                      </div>
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.executionTrace}</p>
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
                    <p className="section-label">{ui.sections.terminalTrace}</p>
                    <div className="stack-card">
                      <strong>
                        {activeRun?.terminalProvider
                          ? `${activeRun.terminalProvider} session`
                          : ui.labels.noLiveTerminal}
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
                    <p className="section-label">{ui.sections.artifactTrace}</p>
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
                    <p className="section-label">{ui.sections.deliverableHistory}</p>
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
                </div>
              ) : (
                <div className="command-center-grid">
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.agentOrg}</p>
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
                    <p className="section-label">{ui.sections.runGraph}</p>
                    <div className="run-graph-list">
                      {rootRuns.map((run) => (
                        <div className="run-graph-node root" key={run.id}>
                          <button
                            className={`run-graph-button${activeRun?.id === run.id ? " selected" : ""}`}
                            onClick={() => {
                              void handleSelectRun(run.id);
                            }}
                            type="button"
                          >
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
                          </button>
                          {parentRunIds.has(run.id) ? (
                            <div className="run-children">
                              {followupRuns
                                .filter((child) => child.origin?.parentRunId === run.id)
                                .map((child) => (
                                  <button
                                    className={`run-graph-button child${activeRun?.id === child.id ? " selected" : ""}`}
                                    key={child.id}
                                    onClick={() => {
                                      void handleSelectRun(child.id);
                                    }}
                                    type="button"
                                  >
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
                                  </button>
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

function getChangedFilesForArtifact(artifact: ArtifactRecord): string[] {
  if (artifact.filePatches?.length) {
    return artifact.filePatches.map((patch) => patch.path);
  }

  if (artifact.type !== "diff") {
    return [];
  }

  return [
    "src/checkout/session.ts",
    "src/auth/recover.ts",
    "test/auth-redirect.spec.ts",
  ];
}

function getFilePatchesForArtifact(artifact: ArtifactRecord): Array<{
  path: string;
  summary?: string;
  patch: string;
}> {
  if (artifact.filePatches?.length) {
    return artifact.filePatches;
  }

  if (artifact.type !== "diff") {
    return [];
  }

  return [
    {
      path: "src/generated/fallback.ts",
      summary: artifact.preview,
      patch: buildFallbackPatch(artifact),
    },
  ];
}

function buildFallbackPatch(artifact: ArtifactRecord): string {
  return `diff --git a/src/generated/fallback.ts b/src/generated/fallback.ts
@@
-// pending patch
+// ${artifact.preview}`;
}

export default App;
