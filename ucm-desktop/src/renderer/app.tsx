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
type ExecutePanel = "patch" | "trace";

const screenCopy: Record<
  AppScreen,
  { eyebrow: string; title: string; body: string }
> = {
  home: {
    eyebrow: "Home",
    title: "Start from missions, not files.",
    body:
      "Open a workspace, create a mission, or choose a template. This screen is for getting started.",
  },
  monitor: {
    eyebrow: "Overview",
    title: "Check mission status and blockers at a glance.",
    body:
      "See active agents, blocked work, and review items in one place.",
  },
  plan: {
    eyebrow: "Plan",
    title: "Define the work before execution starts.",
    body:
      "Write down the goal, constraints, success criteria, and plan.",
  },
  execute: {
    eyebrow: "Run",
    title: "Review code changes and run logs together.",
    body:
      "See changed files, diff output, run events, and user input in one screen.",
  },
  review: {
    eyebrow: "Review",
    title: "Verify outputs and approve what is ready to ship.",
    body:
      "Review test results, decisions, approvals, and deliverables before handoff.",
  },
  settings: {
    eyebrow: "Environment",
    title: "Tune the system without flooding the product surface.",
    body:
      "Change language, provider defaults, and related settings here.",
  },
};

const messages = {
  ko: {
    nav: {
      home: { label: "홈", description: "워크스페이스, 미션, 템플릿 시작" },
      monitor: { label: "모니터", description: "에이전트 팀, 병목, 리뷰 대기열" },
      plan: { label: "계획", description: "목표, 제약, 단계, 팀 구조" },
      execute: { label: "실행", description: "코드 변경, 로그, 사용자 입력" },
      review: { label: "리뷰", description: "테스트 결과, 승인, 전달물 검토" },
      settings: { label: "설정", description: "언어, 프로바이더, 기본 동작 설정" },
    },
    screen: {
      home: {
        eyebrow: "시작 화면",
        title: "파일이 아니라 미션에서 시작합니다.",
        body: "워크스페이스를 열고, 미션을 만들고, 재사용 가능한 템플릿을 고릅니다. 홈은 런처이지 대시보드가 아닙니다.",
      },
      monitor: {
        eyebrow: "운영 화면",
        title: "미션 상태와 병목을 한눈에 봅니다.",
        body: "활성 에이전트, 막힌 작업, 리뷰 대기열을 한 화면에서 봅니다.",
      },
      plan: {
        eyebrow: "미션 계획",
        title: "실행 전에 미션을 정리합니다.",
        body: "목표, 제약, 성공 기준, 팀 구조를 먼저 정리합니다.",
      },
      execute: {
        eyebrow: "실행 화면",
        title: "코드 변경과 실행 추적을 함께 봅니다.",
        body: "변경 파일, diff, 실행 로그, 사용자 입력을 한 화면에서 봅니다.",
      },
      review: {
        eyebrow: "리뷰 화면",
        title: "테스트 결과와 승인 대상을 나눠서 봅니다.",
        body: "테스트, 결정, 승인 대상, 전달물 이력을 검토자 기준으로 정리합니다.",
      },
      settings: {
        eyebrow: "환경",
        title: "핵심 화면을 어지럽히지 않고 시스템을 조정합니다.",
        body: "언어, 프로바이더 기본값, 알림 관련 설정을 여기서 바꿉니다.",
      },
    },
    topbar: { mission: "미션", providers: "프로바이더", agents: "에이전트", blocked: "막힘", review: "리뷰" },
    common: {
      loadingWorkspace: "워크스페이스 불러오는 중...",
      loading: "불러오는 중",
      navigation: "탐색",
      workspaces: "워크스페이스",
      active: "사용 중",
      available: "사용 가능",
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
      patchSurface: "패치",
      testAndDelivery: "테스트 + 전달",
      runLineage: "실행 흐름",
      missionPressure: "현재 상태",
      providerWindows: "프로바이더 상태",
      steeringInbox: "사용자 입력",
      approvalQueue: "승인 대기열",
      emergencyStop: "긴급 중지",
      executionTrace: "실행 추적",
      terminalTrace: "터미널 추적",
      artifactTrace: "산출물 추적",
      deliverableHistory: "전달물 이력",
      missionNotes: "미션 노트",
      missionRisks: "미션 리스크",
      reviewLog: "리뷰 로그",
      lifecycleQueue: "이벤트 목록",
    },
    labels: {
      currentRun: "현재 실행",
      parentRun: "부모 실행",
      childRun: "자식 실행",
      verificationSignal: "테스트 결과",
      latestDecision: "최신 결정",
      deliveryPacket: "전달물",
      briefSteering: "입력 내용",
      activeSteering: "진행 중인 입력",
      steeringHistory: "입력 이력",
      approvalPacket: "승인 대상",
      activeReview: "활성 리뷰",
      approvalHistory: "승인 이력",
      handoffHistory: "전달 이력",
      eventDrivenLoop: "자동 진행 상태",
      noLiveTerminal: "실시간 터미널 없음",
      noPatchYet: "아직 패치 없음",
      noChangedFiles: "아직 변경 파일 없음",
      noDiffPreview: "아직 변경 내용 미리보기가 없습니다.",
      noTestArtifact: "아직 테스트 결과 산출물이 없습니다.",
      noDecision: "아직 결정 요약이 없습니다.",
      noDeliverable: "아직 활성 전달물 리비전이 없습니다.",
    },
    actions: {
      createMission: "미션 생성",
      addWorkspace: "워크스페이스 추가",
      retryRun: "다시 실행",
      submitSteering: "입력 보내기",
      approveLatest: "최신본 승인",
      stopSession: "세션 중지",
    },
  },
  en: {
    nav: {
      home: { label: "Home", description: "Launch workspaces, missions, and templates" },
      monitor: { label: "Monitor", description: "Agent teams, bottlenecks, and review queues" },
      plan: { label: "Plan", description: "Goals, constraints, phases, and team shape" },
      execute: { label: "Execute", description: "Code changes, logs, and user input" },
      review: { label: "Review", description: "Tests, approvals, and deliverables" },
      settings: { label: "Settings", description: "Language, providers, and runtime defaults" },
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
      missionLauncher: "Create Mission",
      agentOrg: "Agent Org",
      runGraph: "Run Graph",
      goal: "Goal",
      successCriteria: "Success Criteria",
      constraints: "Constraints",
      planPhases: "Plan Phases",
      changedFiles: "Changed Files",
      patchSurface: "Patch",
      testAndDelivery: "Test + Delivery",
      runLineage: "Run Flow",
      missionPressure: "Current Status",
      providerWindows: "Provider Status",
      steeringInbox: "User Input",
      approvalQueue: "Approval Queue",
      emergencyStop: "Emergency Stop",
      executionTrace: "Execution Trace",
      terminalTrace: "Terminal Trace",
      artifactTrace: "Artifact Trace",
      deliverableHistory: "Deliverable History",
      missionNotes: "Mission Notes",
      missionRisks: "Mission Risks",
      reviewLog: "Review Log",
      lifecycleQueue: "Event List",
    },
    labels: {
      currentRun: "Current Run",
      parentRun: "Parent Run",
      childRun: "Child Run",
      verificationSignal: "Test Result",
      latestDecision: "Latest Decision",
      deliveryPacket: "Deliverable",
      briefSteering: "Input",
      activeSteering: "Active Input",
      steeringHistory: "Input History",
      approvalPacket: "Approval Item",
      activeReview: "Active Review",
      approvalHistory: "Approval History",
      handoffHistory: "Handoff History",
      eventDrivenLoop: "Auto progress",
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
      addWorkspace: "Add Workspace",
      retryRun: "Run Again",
      submitSteering: "Send Input",
      approveLatest: "Approve Latest",
      stopSession: "Stop Session",
    },
  },
} as const;

type UiMessages = (typeof messages)[Locale];

const missionTemplates = {
  ko: [
    {
      id: "bugfix",
      label: "버그 수정",
      title: "결제 회귀 오류 수정",
      goal: "최근 변경 이후 깨진 결제 흐름을 복구하고 영향 범위를 확인합니다.",
      command: "npm test",
    },
    {
      id: "verify",
      label: "검증 실행",
      title: "현재 상태 검증",
      goal: "선택한 워크스페이스의 현재 상태를 빠르게 확인하고 실패 지점을 수집합니다.",
      command: "npm run build",
    },
    {
      id: "plan",
      label: "계획만 시작",
      title: "배포 전 정리",
      goal: "배포 전에 남은 위험과 확인 항목을 정리합니다.",
      command: "",
    },
  ],
  en: [
    {
      id: "bugfix",
      label: "Bug Fix",
      title: "Fix checkout regression",
      goal: "Restore the broken checkout path and confirm the blast radius.",
      command: "npm test",
    },
    {
      id: "verify",
      label: "Verify",
      title: "Verify current state",
      goal: "Check the selected workspace and collect the first failing signal.",
      command: "npm run build",
    },
    {
      id: "plan",
      label: "Plan Only",
      title: "Prepare release review",
      goal: "Organize the remaining risks and review items before release.",
      command: "",
    },
  ],
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
    useState<AppScreen>("monitor");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [command, setCommand] = useState("");
  const [steeringInput, setSteeringInput] = useState("");
  const [selectedPatchPath, setSelectedPatchPath] = useState<string | null>(null);
  const [executePanel, setExecutePanel] = useState<ExecutePanel>("patch");
  const [autopilotResult, setAutopilotResult] = useState<RunAutopilotResult>({
    run: null,
    eventKind: "none",
    decision: "observe",
    summary: "다음 실행 이벤트를 기다리는 중입니다.",
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
    setExecutePanel("patch");
  }, [activeRun?.id]);

  async function handleCreateMission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeWorkspace = workspaces.find((workspace) => workspace.active);
    if (!activeWorkspace || !title.trim() || !goal.trim()) return;
    await window.ucm.mission.create({
      workspaceId: activeWorkspace.id,
      title,
      goal,
      command,
    });
    setTitle("");
    setGoal("");
    setCommand("");
    setActiveScreen("monitor");
    void window.ucm.app.getVersion().then(setVersion);
    await refresh();
  }

  function applyMissionTemplate(
    templateId: (typeof missionTemplates)["ko"][number]["id"],
  ) {
    const template = missionTemplates[locale].find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    setTitle(template.title);
    setGoal(template.goal);
    setCommand(template.command);
  }

  async function handleSelectWorkspace(workspaceId: string) {
    await window.ucm.workspace.setActive({ workspaceId });
    await refresh();
  }

  async function handleAddWorkspace() {
    const selectedPath = await window.ucm.workspace.pickDirectory();
    if (!selectedPath) {
      return;
    }
    await window.ucm.workspace.add({ rootPath: selectedPath });
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
    setActiveScreen("execute");
    await refresh();
  }

  async function handleRetryRun(runId: string) {
    await window.ucm.run.retry({ runId });
    setActiveScreen("execute");
    await refresh();
  }

  async function handleOpenMission(missionId: string) {
    await window.ucm.mission.setActive({ missionId });
    const refreshedRun = await window.ucm.run.getActive();
    setActiveScreen(refreshedRun ? "execute" : "plan");
    await refresh();
  }

  const current = messages[locale].screen[activeScreen];
  const navCopy = messages[locale].nav;
  const ui = messages[locale];
  const activeWorkspace = workspaces.find((workspace) => workspace.active) ?? null;
  const canCreateMission = Boolean(activeWorkspace && title.trim() && goal.trim());
  const missionModeSummary = command.trim()
    ? locale === "ko"
      ? `입력한 명령을 바로 실행합니다: ${command.trim()}`
      : `Run this command immediately: ${command.trim()}`
    : locale === "ko"
      ? "명령 없이 미션만 만들고 계획 단계에서 시작합니다."
      : "Create the mission without a command and start from planning.";
  const selectedMissionTitle = activeMission?.title ?? snapshot?.missionName ?? (locale === "ko" ? "선택된 미션 없음" : "No mission");
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
      ? `${activeRun.providerPreference}`
      : `${activeRun.providerPreference}`
    : locale === "ko"
      ? "프로바이더"
      : "provider";
  const providerSummary =
    (snapshot?.providerWindows ?? [])
      .map((windowInfo) => `${windowInfo.provider}:${windowInfo.status}`)
      .join(" • ") || (locale === "ko" ? "불러오는 중" : "loading");
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
  const attentionEvents = (snapshot?.lifecycleEvents ?? []).filter((event) =>
    ["blocked", "needs_review", "review_requested", "steering_requested"].includes(event.kind),
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-intro">
          <p className="eyebrow">UCM Desktop</p>
          <h1>{snapshot?.workspaceName ?? ui.common.loadingWorkspace}</h1>
          <p className="topbar-copy">
            {selectedMissionTitle}
          </p>
        </div>
        <div className="topbar-metrics">
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
            <div className="detail-header">
              <p className="section-label">{ui.common.workspaces}</p>
              <button className="secondary-button" onClick={() => {
                void handleAddWorkspace();
              }} type="button">
                {ui.actions.addWorkspace}
              </button>
            </div>
            <div className="stack-list">
              {workspaces.map((workspace) => (
                <button
                  className="stack-card"
                  key={workspace.id}
                  onClick={() => {
                    void handleSelectWorkspace(workspace.id);
                  }}
                  type="button"
                >
                  <strong>{workspace.name}</strong>
                  <span className={`status ${workspace.active ? "status-running" : "status-queued"}`}>
                    {workspace.active ? ui.common.active : ui.common.available}
                  </span>
                </button>
              ))}
              {workspaces.length === 0 ? (
                <div className="stack-card">
                  <strong>{locale === "ko" ? "워크스페이스가 없습니다." : "No workspaces yet."}</strong>
                  <p className="stack-copy">
                    {locale === "ko"
                      ? "로컬 프로젝트 폴더를 추가하면 여기서 바로 선택할 수 있습니다."
                      : "Add a local project folder to select it here."}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <main className={`main-surface screen-${activeScreen}`}>
          <section className={`hero-card hero-card-${activeScreen}`}>
            <p className="eyebrow">{current.eyebrow}</p>
            <h2>{current.title}</h2>
            <p>{current.body}</p>
          </section>

          <section className={`content-grid content-grid-${activeScreen}`}>
            <div className="panel org-panel">
              {activeScreen !== "monitor" ? (
                <div className="panel-head">
                  <h3>
                    {activeScreen === "home"
                      ? "Create Mission"
                      : activeScreen === "plan"
                        ? selectedMissionTitle
                        : activeScreen === "execute" || activeScreen === "review"
                          ? activeRun?.title ?? (locale === "ko" ? "실행" : "Run")
                          : activeScreen === "settings"
                            ? (locale === "ko" ? "시스템 설정" : "System Settings")
                            : (locale === "ko" ? "에이전트 현황" : "Agent Status")}
                  </h3>
                  <span>
                    {activeScreen === "home"
                      ? `${missions.length} missions`
                      : activeScreen === "plan"
                        ? `${activeMission?.phases.length ?? 0} ${ui.common.phases}`
                        : activeScreen === "execute" || activeScreen === "review"
                          ? `${activeRun?.runEvents.length ?? 0} ${ui.common.runEvents}`
                          : activeScreen === "settings"
                            ? `${snapshot?.providerWindows.length ?? 0} providers`
                            : `${snapshot?.agents.length ?? 0} ${ui.common.teamMembers}`}
                  </span>
                </div>
              ) : null}
              {activeScreen === "home" ? (
                <div className="launcher-grid">
                  <section className="detail-block mission-compose">
                    <div className="detail-header mission-compose-header">
                      <div>
                        <p className="section-label">{ui.sections.missionLauncher}</p>
                        <h4>{locale === "ko" ? "새 미션 시작" : "Start a new mission"}</h4>
                      </div>
                      <span className={`status ${activeWorkspace ? "status-running" : "status-blocked"}`}>
                        {activeWorkspace ? activeWorkspace.name : (locale === "ko" ? "워크스페이스 없음" : "No workspace")}
                      </span>
                    </div>
                    <p className="stack-copy mission-compose-copy">
                      {activeWorkspace?.rootPath ??
                        (locale === "ko"
                          ? "먼저 왼쪽에서 워크스페이스를 추가하고 선택하세요."
                          : "Add and select a workspace from the left rail first.")}
                    </p>
                    <div className="mission-template-strip">
                      {missionTemplates[locale].map((template) => (
                        <button
                          className="template-chip"
                          key={template.id}
                          onClick={() => applyMissionTemplate(template.id)}
                          type="button"
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    <form className="mission-form" onSubmit={handleCreateMission}>
                      <label>
                        {locale === "ko" ? "미션 제목" : "Mission title"}
                        <input
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder={locale === "ko" ? "예: 결제 인증 회귀 오류 수정" : "Checkout auth regression fix"}
                          value={title}
                        />
                      </label>
                      <label>
                        {locale === "ko" ? "목표" : "Goal"}
                        <textarea
                          onChange={(event) => setGoal(event.target.value)}
                          placeholder={locale === "ko" ? "예: 인증 흐름을 깨지 않고 결제 안정성 복구" : "Restore checkout stability without breaking auth flow."}
                          rows={4}
                          value={goal}
                        />
                      </label>
                      <label>
                        {locale === "ko" ? "작업 명령" : "Workspace command"}
                        <input
                          onChange={(event) => setCommand(event.target.value)}
                          placeholder={
                            locale === "ko"
                              ? "예: npm test 또는 npm run build"
                              : "Example: npm test or npm run build"
                          }
                          value={command}
                        />
                      </label>
                      <div className="mission-submit-bar">
                        <div className="stack-card mission-launch-summary">
                          <strong>{locale === "ko" ? "실행 방식" : "Launch mode"}</strong>
                          <p className="stack-copy">{missionModeSummary}</p>
                        </div>
                        <button className="primary-button" disabled={!canCreateMission} type="submit">
                          {ui.actions.createMission}
                        </button>
                      </div>
                    </form>
                  </section>

                  <div className="stack-list mission-history-list">
                    {missions.map((mission) => (
                      <button
                        className={`stack-card mission-history-card${
                          mission.id === activeMission?.id ? " active" : ""
                        }`}
                        key={mission.id}
                        onClick={() => {
                          void handleOpenMission(mission.id);
                        }}
                        type="button"
                      >
                        <div className="mission-history-head">
                          <strong>{mission.title}</strong>
                          <div className="mission-history-status">
                            {mission.id === activeMission?.id ? (
                              <span className="status status-running">
                                {locale === "ko" ? "선택됨" : "Selected"}
                              </span>
                            ) : null}
                            <span className={`status status-${mission.status}`}>
                              {formatStatusLabel(mission.status, locale)}
                            </span>
                            {mission.attentionRequired ? (
                              <span className="status status-blocked">
                                {locale === "ko" ? "확인 필요" : "Attention"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <p className="stack-copy">
                          {locale === "ko" ? "요청" : "Request"}: {mission.goal ?? mission.title}
                        </p>
                        {mission.command ? (
                          <p className="stack-copy">
                            {locale === "ko" ? "입력" : "Input"}: ${mission.command}
                          </p>
                        ) : null}
                        <p className="stack-copy">
                          {locale === "ko" ? "최근 결과" : "Latest Result"}:{" "}
                          {mission.latestResult ??
                            (locale === "ko"
                              ? "아직 결과가 없습니다."
                              : "No result yet.")}
                        </p>
                        <p className="stack-copy mission-history-meta">
                          {formatStatusLabel(mission.lineStatus ?? mission.status, locale)}
                          {" • "}
                          {locale === "ko"
                            ? `산출물 ${mission.artifactCount ?? 0}개`
                            : `${mission.artifactCount ?? 0} artifacts`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : activeScreen === "plan" ? (
                <div className="mission-detail-grid">
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.goal}</p>
                    <h4>{activeMission?.goal ?? (locale === "ko" ? "선택된 미션이 없습니다." : "No active mission selected.")}</h4>
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
                            {formatStatusLabel(phase.status === "active" ? "running" : phase.status === "done" ? "review" : "queued", locale)}
                          </span>
                          <p className="stack-copy">{phase.objective}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              ) : activeScreen === "execute" ? (
                <ExecuteScreen
                  activeProviderLabel={activeProviderLabel}
                  activeRun={activeRun}
                  activeRunBudgetLabel={activeRunBudgetLabel}
                  activeRunChildren={activeRunChildren}
                  activeRunParent={activeRunParent}
                  activeSteeringEvents={activeSteeringEvents}
                  archivedSteeringEvents={archivedSteeringEvents}
                  autopilotResult={autopilotResult}
                  changedFiles={changedFiles}
                  diffArtifact={diffArtifact}
                  diffFilePatches={diffFilePatches}
                  executePanel={executePanel}
                  handleRetryRun={handleRetryRun}
                  handleSelectRun={handleSelectRun}
                  handleSteeringSubmit={handleSteeringSubmit}
                  handleTerminalStop={handleTerminalStop}
                  latestSteeringRequest={latestSteeringRequest}
                  locale={locale}
                  providerSummary={providerSummary}
                  selectedPatch={selectedPatch}
                  setExecutePanel={setExecutePanel}
                  setSelectedPatchPath={setSelectedPatchPath}
                  steeringInput={steeringInput}
                  ui={ui}
                  onSteeringInputChange={setSteeringInput}
                />
              ) : activeScreen === "review" ? (
                <ReviewScreen
                  activeApprovalPackets={activeApprovalPackets}
                  activeRun={activeRun}
                  handleApproveRevision={handleApproveRevision}
                  latestApprovalPacket={latestApprovalPacket}
                  locale={locale}
                  primaryDecision={primaryDecision}
                  primaryDeliverable={primaryDeliverable}
                  recentApprovalHandoffs={recentApprovalHandoffs}
                  testArtifacts={testArtifacts}
                  ui={ui}
                />
              ) : activeScreen === "settings" ? (
                <div className="mission-detail-grid">
                  <section className="detail-block">
                    <p className="section-label">{ui.common.language}</p>
                    <div className="button-row">
                      <button className="primary-button" onClick={() => setLocale("ko")} type="button">
                        {ui.common.korean}
                      </button>
                      <button className="primary-button" onClick={() => setLocale("en")} type="button">
                        {ui.common.english}
                      </button>
                    </div>
                  </section>
                  <section className="detail-block">
                    <p className="section-label">{ui.sections.providerWindows}</p>
                    <div className="revision-list">
                      {(snapshot?.providerWindows ?? []).map((windowInfo) => (
                        <div className="revision-item" key={windowInfo.provider}>
                          <strong>{windowInfo.provider}</strong>
                          <span>
                            {formatStatusLabel(windowInfo.status, locale)} • {locale === "ko" ? `${windowInfo.activeRuns}개 사용 중` : `${windowInfo.activeRuns} active`} • {locale === "ko" ? `${windowInfo.queuedRuns}개 대기` : `${windowInfo.queuedRuns} queued`}
                          </span>
                          <p>Next slot: {windowInfo.nextAvailableLabel}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="detail-block">
                    <div className="detail-header">
                      <p className="section-label">{ui.common.workspaces}</p>
                      <button className="secondary-button" onClick={() => {
                        void handleAddWorkspace();
                      }} type="button">
                        {ui.actions.addWorkspace}
                      </button>
                    </div>
                    <div className="stack-list">
                      {workspaces.map((workspace) => (
                        <button
                          className="stack-card"
                          key={workspace.id}
                          onClick={() => {
                            void handleSelectWorkspace(workspace.id);
                          }}
                          type="button"
                        >
                          <strong>{workspace.name}</strong>
                          <span className={`status ${workspace.active ? "status-running" : "status-queued"}`}>
                            {workspace.active ? ui.common.active : ui.common.available}
                          </span>
                          <p className="stack-copy">{workspace.rootPath}</p>
                        </button>
                      ))}
                      {workspaces.length === 0 ? (
                        <div className="stack-card">
                          <strong>{locale === "ko" ? "등록된 워크스페이스가 없습니다." : "No registered workspaces."}</strong>
                          <p className="stack-copy">
                            {locale === "ko"
                              ? "프로젝트 폴더를 추가하면 선택 목록에 반영됩니다."
                              : "Added project folders appear in the workspace list."}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              ) : (
                <MonitorScreen
                  activeRun={activeRun}
                  handleSelectRun={handleSelectRun}
                  latestEventByAgentId={latestEventByAgentId}
                  locale={locale}
                  rootRuns={rootRuns}
                  followupRuns={followupRuns}
                  snapshot={snapshot}
                  ui={ui}
                />
              )}
            </div>

            <div className="panel inspector-panel">
              <div className="panel-head">
                <h3>
                  {activeScreen === "home"
                    ? (locale === "ko" ? "메모" : "Notes")
                    : activeScreen === "plan"
                      ? (locale === "ko" ? "리스크" : "Risks")
                      : activeScreen === "execute"
                        ? (locale === "ko" ? "실행 메모" : "Run Notes")
                        : activeScreen === "review"
                      ? (locale === "ko" ? "리뷰 메모" : "Review Notes")
                      : activeScreen === "settings"
                        ? (locale === "ko" ? "설정 메모" : "Settings Notes")
                            : (locale === "ko" ? "주의 이벤트" : "Attention Items")}
                </h3>
                <span>v{version}</span>
              </div>
              {activeScreen === "home" ? (
                <ul className="principles">
                  <li>Start from a workspace and a mission, not from individual files.</li>
                  <li>Creating a mission immediately updates the current view.</li>
                  <li>Use this screen to create work, not to monitor progress.</li>
                </ul>
              ) : activeScreen === "plan" ? (
                <ul className="principles">
                  {(activeMission?.risks ?? []).map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : activeScreen === "execute" || activeScreen === "review" ? (
                <div className="stack-list">
                  {(activeRun?.decisions ?? []).map((decision) => (
                    <DecisionCard decision={decision} key={decision.id} locale={locale} />
                  ))}
                </div>
              ) : activeScreen === "settings" ? (
                <ul className="principles">
                  <li>Keep global settings separate from mission and run screens.</li>
                  <li>Language and provider defaults should stay in one place.</li>
                  <li>Settings should support the main workflow, not interrupt it.</li>
                </ul>
              ) : (
                <div className="attention-list">
                  {attentionEvents.map((event) => (
                    <div className="attention-item" key={event.id}>
                      <div className="attention-main">
                        <strong>{event.summary}</strong>
                        <p className="attention-meta">
                          {event.agentId} • {event.createdAtLabel}
                        </p>
                      </div>
                      <span className={`status status-${getAttentionTone(event.kind)}`}>
                        {formatEventKind(event.kind, locale)}
                      </span>
                    </div>
                  ))}
                  {attentionEvents.length === 0 ? (
                    <div className="attention-empty">
                      <strong>{locale === "ko" ? "주의할 항목이 없습니다." : "No attention items."}</strong>
                      <p>{locale === "ko" ? "중단되거나 확인이 필요한 항목이 생기면 여기에 표시됩니다." : "Blocked runs and review requests will appear here."}</p>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="inspector-box">
                <p className="section-label">
                  {activeScreen === "monitor"
                    ? (locale === "ko" ? "표시 기준" : "Display Rule")
                    : (locale === "ko" ? "다음 단계" : "Next Step")}
                </p>
                <p>
                  {activeScreen === "home"
                    ? (locale === "ko"
                      ? "미션 생성 흐름이 확정되면 추가 입력 항목을 넣습니다."
                      : "Add more fields to mission creation when the workflow is finalized.")
                    : activeScreen === "plan"
                      ? (locale === "ko"
                        ? "계획 수정과 팀 배정을 별도 작업으로 분리합니다."
                        : "Move plan editing and team assignment into dedicated actions.")
                      : activeScreen === "execute"
                        ? (locale === "ko"
                          ? "이 화면이 더 커지면 로그, 산출물, 입력을 탭으로 분리합니다."
                          : "Split logs, artifacts, and input into clearer tabs if this screen grows further.")
                        : activeScreen === "review"
                          ? (locale === "ko"
                            ? "리뷰 항목이 많아지면 테스트 결과, 승인, 전달을 탭으로 나눕니다."
                            : "Split review work into separate tabs for test results, approval, and handoff if volume increases.")
                          : activeScreen === "settings"
                            ? (locale === "ko"
                              ? "프로바이더 기본값과 알림 설정을 수정 가능한 폼으로 옮깁니다."
                              : "Move provider defaults and notifications into editable forms backed by runtime state.")
                            : (locale === "ko"
                              ? "여기에는 중단, 검토 필요, 입력 요청처럼 바로 확인해야 하는 항목만 표시합니다."
                              : "Show only items that need immediate attention here, such as blocked runs and review requests.")}
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ExecuteScreen({
  activeProviderLabel,
  activeRun,
  activeRunBudgetLabel,
  activeRunChildren,
  activeRunParent,
  activeSteeringEvents,
  archivedSteeringEvents,
  autopilotResult,
  changedFiles,
  diffArtifact,
  diffFilePatches,
  executePanel,
  handleRetryRun,
  handleSelectRun,
  handleSteeringSubmit,
  handleTerminalStop,
  latestSteeringRequest,
  locale,
  providerSummary,
  selectedPatch,
  setExecutePanel,
  setSelectedPatchPath,
  steeringInput,
  ui,
  onSteeringInputChange,
}: {
  activeProviderLabel: string;
  activeRun: RunDetail | null;
  activeRunBudgetLabel: string;
  activeRunChildren: RunDetail[];
  activeRunParent: RunDetail | null;
  activeSteeringEvents: RunDetail["runEvents"];
  archivedSteeringEvents: RunDetail["runEvents"];
  autopilotResult: RunAutopilotResult;
  changedFiles: string[];
  diffArtifact: ArtifactRecord | null;
  diffFilePatches: Array<{ path: string; summary?: string; patch: string }>;
  executePanel: ExecutePanel;
  handleRetryRun: (runId: string) => Promise<void>;
  handleSelectRun: (runId: string) => Promise<void>;
  handleSteeringSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleTerminalStop: () => Promise<void>;
  latestSteeringRequest: RunDetail["runEvents"][number] | null;
  locale: Locale;
  providerSummary: string;
  selectedPatch: { path: string; summary?: string; patch: string } | null;
  setExecutePanel: (panel: ExecutePanel) => void;
  setSelectedPatchPath: (path: string) => void;
  steeringInput: string;
  ui: UiMessages;
  onSteeringInputChange: (value: string) => void;
}) {
  if (!activeRun) {
    return (
      <div className="monitor-empty">
        <strong>{locale === "ko" ? "선택된 실행이 없습니다." : "No run selected."}</strong>
        <p>
          {locale === "ko"
            ? "모니터에서 실행을 선택하거나 홈에서 미션을 만들어 실행을 시작하세요."
            : "Select a run from Monitor or create a mission from Home to start execution."}
        </p>
      </div>
    );
  }

  return (
    <div className="workbench-grid">
      <div className="execute-command-bar">
        <div className="stack-card command-pill">
          <strong>{locale === "ko" ? "실행 상태" : "Run Status"}</strong>
          <span className="status status-running">{formatStatusLabel(activeRun?.status ?? "idle", locale)}</span>
          <p className="stack-copy">{activeRun?.summary ?? ui.labels.noPatchYet}</p>
        </div>
        <div className="stack-card command-pill">
          <strong>{locale === "ko" ? "사용자 확인" : "User Attention"}</strong>
          <span className="status status-review">
            {latestSteeringRequest ? (locale === "ko" ? "확인 필요" : "attention") : (locale === "ko" ? "정상" : "stable")}
          </span>
          <p className="stack-copy">
            {latestSteeringRequest?.summary ??
              (locale === "ko"
                ? "현재 실행은 자동 진행 중입니다."
                : "The current run is continuing automatically.")}
          </p>
        </div>
        <div className="stack-card command-pill">
          <strong>{locale === "ko" ? "결과물" : "Outputs"}</strong>
          <span className="status status-queued">
            {activeRun?.deliverables.length ?? 0}{locale === "ko" ? "개" : " items"}
          </span>
          <p className="stack-copy">
            {activeRunBudgetLabel} • {activeProviderLabel}
          </p>
          {activeRun.workspaceCommand ? (
            <div className="button-row">
              <button
                className="secondary-button"
                disabled={activeRun.status === "running"}
                onClick={() => {
                  void handleRetryRun(activeRun.id);
                }}
                type="button"
              >
                {ui.actions.retryRun}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="workbench-primary">
        <section className="detail-block workbench-files">
          <div className="detail-header">
            <p className="section-label">{ui.sections.changedFiles}</p>
            <span className="detail-meta">{locale === "ko" ? `${changedFiles.length}개 파일` : `${changedFiles.length} files`}</span>
          </div>
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
                  <span className="status status-review">{formatArtifactType("diff", locale)}</span>
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
                    ? "현재 실행이 아직 코드 변경을 만들지 않았습니다."
                    : "The current run has not emitted a code diff yet."}
                </p>
              </div>
            )}
          </div>
        </section>
        <section className="detail-block workbench-diff">
          <div className="detail-header">
            <p className="section-label">
              {executePanel === "patch"
                ? ui.sections.patchSurface
                : ui.sections.executionTrace}
            </p>
            <div className="segmented-control" role="tablist" aria-label="execute panels">
              <button
                className={executePanel === "patch" ? "segmented-button active" : "segmented-button"}
                onClick={() => setExecutePanel("patch")}
                type="button"
              >
                {locale === "ko" ? "패치" : "Patch"}
              </button>
              <button
                className={executePanel === "trace" ? "segmented-button active" : "segmented-button"}
                onClick={() => setExecutePanel("trace")}
                type="button"
              >
                {locale === "ko" ? "추적" : "Trace"}
              </button>
            </div>
          </div>
          {executePanel === "patch" ? (
            <>
              <div className="stack-card diff-spotlight">
                <strong>{selectedPatch?.path ?? diffArtifact?.title ?? ui.labels.noPatchYet}</strong>
                <span className="status status-running">
                  {formatStatusLabel(activeRun?.status ?? "idle", locale)}
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
    : locale === "ko" ? "// 패치 출력 대기 중" : "// waiting for patch output")}
              </pre>
            </>
          ) : (
            <div className="execute-trace-grid">
              <section className="detail-block compact-block">
                <p className="section-label">{ui.sections.executionTrace}</p>
                <div className="timeline-list">
                  {(activeRun?.runEvents ?? []).map((event) => (
                    <div className="timeline-item" key={event.id}>
                      <strong>{event.summary}</strong>
                      <span>
                        {formatEventKind(event.kind, locale)}
                        {event.agentId ? ` • ${event.agentId}` : ""}
                        {event.metadata?.budgetClass
                          ? ` • ${locale === "ko" ? `${event.metadata.budgetClass} 버짓` : `${event.metadata.budgetClass} budget`}`
                          : ""}
                        {` • ${event.createdAtLabel}`}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="detail-block compact-block">
                <p className="section-label">{ui.sections.terminalTrace}</p>
                <div className="stack-card">
                  <strong>
                    {activeRun?.terminalProvider
                      ? `${activeRun.terminalProvider} ${locale === "ko" ? "세션" : "session"}`
                      : ui.labels.noLiveTerminal}
                  </strong>
                  <span className="status status-running">
                    {activeRun?.terminalSessionId ?? (locale === "ko" ? "없음" : "offline")}
                  </span>
                  <p className="stack-copy">
                    {locale === "ko"
                      ? "터미널은 읽기 전용입니다."
                      : "Terminal stays observation-first."}
                  </p>
                </div>
                <pre className="terminal-preview compact-preview">
                  {(activeRun?.terminalPreview ?? []).join("\n")}
                </pre>
              </section>
              <section className="detail-block compact-block">
                <p className="section-label">{ui.sections.artifactTrace}</p>
                <div className="stack-list">
                  {(activeRun?.artifacts ?? []).map((artifact) => (
                    <div className="stack-card" key={artifact.id}>
                      <strong>{artifact.title}</strong>
                      <span className="status status-review">{formatArtifactType(artifact.type, locale)}</span>
                      <p className="stack-copy">{artifact.preview}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
      <div className="workbench-secondary">
        <section className="detail-block workbench-side">
          <p className="section-label">{ui.sections.missionPressure}</p>
          <div className="stack-list">
            <div className="stack-card">
              <strong>{ui.labels.eventDrivenLoop}</strong>
              <span className="status status-running">
                {autopilotResult.decision === "observe"
                  ? (locale === "ko" ? "자동 진행 중" : "watching")
                  : (locale === "ko" ? "처리 중" : "in progress")}
              </span>
              <p className="stack-copy">{autopilotResult.summary}</p>
              <p className="stack-copy">{locale === "ko" ? `최근 이벤트: ${autopilotResult.eventKind}` : `Last event: ${autopilotResult.eventKind}`}</p>
              <p className="stack-copy">{locale === "ko" ? `실행 예산: ${activeRunBudgetLabel}` : `Run budget: ${activeRunBudgetLabel}`}</p>
            </div>
            <div className="stack-card">
              <strong>{ui.sections.providerWindows}</strong>
              <span className="status status-review">{activeProviderLabel}</span>
              <p className="stack-copy">{providerSummary}</p>
            </div>
            <div className="stack-card">
              <strong>{ui.labels.briefSteering}</strong>
              <span className="status status-review">
                {activeSteeringEvents.length > 0
                  ? `${activeSteeringEvents.length} active`
                  : latestSteeringRequest
                    ? (locale === "ko" ? "입력 요청" : "requested")
                    : (locale === "ko" ? "없음" : "quiet")}
              </span>
              <p className="stack-copy">
                {activeSteeringEvents[0]?.metadata?.steering ??
                  latestSteeringRequest?.summary ??
                  (locale === "ko" ? "현재 요청된 입력이 없습니다." : "No input request is active.")}
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
                  {activeRun?.status ?? (locale === "ko" ? "알 수 없음" : "unknown")}
                </span>
                <p className="stack-copy">
                  {activeRun?.title ?? (locale === "ko" ? "선택된 실행이 없습니다." : "No active run selected.")}
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
                    {formatStatusLabel(activeRunParent.status, locale)}
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
                      <span className={`status status-${getStatusTone(child.status)}`}>
                        {formatStatusLabel(child.status, locale)}
                      </span>
                      <p className="stack-copy">{child.title}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
          <section className="detail-block">
            <p className="section-label">{ui.sections.steeringInbox}</p>
            <div className="action-stack">
              <div className="stack-card">
                <strong>{ui.labels.briefSteering}</strong>
                <span className="status status-review">
                  {activeSteeringEvents.length > 0
                    ? (locale === "ko" ? `${activeSteeringEvents.length}개 진행 중` : `${activeSteeringEvents.length} active`)
                    : latestSteeringRequest
                      ? (locale === "ko" ? "입력 요청" : "requested")
                      : (locale === "ko" ? "없음" : "quiet")}
                </span>
                <p className="stack-copy">
                  {activeSteeringEvents[0]?.metadata?.steering ??
                    latestSteeringRequest?.summary ??
                    (locale === "ko"
                      ? "현재 요청된 입력이 없습니다."
                      : "No input request is active.")}
                </p>
                <form className="mission-form" onSubmit={handleSteeringSubmit}>
                  <label>
                    {ui.labels.briefSteering}
                    <input
                      onChange={(event) => onSteeringInputChange(event.target.value)}
                      placeholder="예: checkout 회귀 테스트용 fallback fixture를 사용"
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
                        {formatStatusLabel(event.metadata?.status ?? "active", locale)}
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
                        {formatStatusLabel(event.metadata?.status ?? "superseded", locale)}
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
            <p className="section-label">{ui.sections.emergencyStop}</p>
            <div className="action-stack">
              <div className="stack-card">
                <strong>{ui.sections.emergencyStop}</strong>
                <span className="status status-blocked">
                  {activeRun?.terminalSessionId ? (locale === "ko" ? "사용 가능" : "armed") : (locale === "ko" ? "대기" : "idle")}
                </span>
                <p className="stack-copy">
                  {locale === "ko"
                    ? "기본 화면에서 제공하는 직접 제어는 세션 중지만 가능합니다."
                    : "Stop is the only direct terminal intervention exposed in the default surface."}
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
            <p className="section-label">{ui.sections.deliverableHistory}</p>
            <div className="stack-list">
              {(activeRun?.deliverables ?? []).map((deliverable) => (
                <div className="stack-card" key={deliverable.id}>
                  <strong>{deliverable.title}</strong>
                  <span className="status status-review">
                    {formatDeliverableKind(deliverable.kind, locale)}
                  </span>
                  <p className="stack-copy">
                    {locale === "ko" ? "최신 버전: " : "Latest revision: "}
                    {
                      deliverable.revisions.find(
                        (revision) =>
                          revision.id === deliverable.latestRevisionId,
                      )?.summary
                    }
                  </p>
                  {activeRun?.origin?.schedulerRuleId ? (
                    <p className="stack-copy">
                      {locale === "ko"
                        ? `규칙: ${activeRun.origin.schedulerRuleId} • ${activeRunBudgetLabel} • ${activeProviderLabel}`
                        : `Rule: ${activeRun.origin.schedulerRuleId} • ${activeRunBudgetLabel} • ${activeProviderLabel}`}
                    </p>
                  ) : null}
                  <div className="revision-list">
                    {deliverable.revisions.map((revision) => (
                      <div className="revision-item" key={revision.id}>
                        <strong>v{revision.revision}</strong>
                        <span>{revision.createdAtLabel} • {formatStatusLabel(revision.status, locale)}</span>
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
    </div>
  );
}

function ReviewScreen({
  activeApprovalPackets,
  activeRun,
  handleApproveRevision,
  latestApprovalPacket,
  locale,
  primaryDecision,
  primaryDeliverable,
  recentApprovalHandoffs,
  testArtifacts,
  ui,
}: {
  activeApprovalPackets: Array<RunDetail["deliverables"][number]["revisions"][number]>;
  activeRun: RunDetail | null;
  handleApproveRevision: (revisionId: string) => Promise<void>;
  latestApprovalPacket: RunDetail["deliverables"][number]["revisions"][number] | null;
  locale: Locale;
  primaryDecision: DecisionRecord | null;
  primaryDeliverable: RunDetail["deliverables"][number] | null;
  recentApprovalHandoffs: RunDetail["handoffs"];
  testArtifacts: ArtifactRecord[];
  ui: UiMessages;
}) {
  if (!activeRun) {
    return (
      <div className="monitor-empty">
        <strong>{locale === "ko" ? "검토할 실행이 없습니다." : "No run is ready for review."}</strong>
        <p>
          {locale === "ko"
            ? "실행이 생성되고 결과물이 쌓이면 이 화면에서 검토할 수 있습니다."
            : "This screen becomes useful once a run has artifacts and approval items."}
        </p>
      </div>
    );
  }

  return (
    <div className="review-board">
      <section className="detail-block review-lead">
        <p className="section-label">{locale === "ko" ? "요약" : "Summary"}</p>
        <div className="review-focus-grid">
          <div className="stack-card">
            <strong>{ui.labels.verificationSignal}</strong>
            <span className="status status-review">
              {testArtifacts.length > 0
                ? (locale === "ko" ? `${testArtifacts.length}개 결과` : `${testArtifacts.length} test artifacts`)
                : (locale === "ko" ? "대기" : "pending")}
            </span>
            <p className="stack-copy">
              {testArtifacts[0]?.preview ?? ui.labels.noTestArtifact}
            </p>
          </div>
          <div className="stack-card">
            <strong>{ui.labels.deliveryPacket}</strong>
            <span className="status status-running">
              {primaryDeliverable?.kind ? formatDeliverableKind(primaryDeliverable.kind, locale) : formatStatusLabel("none", locale)}
            </span>
            <p className="stack-copy">
              {primaryDeliverable?.revisions.find(
                (revision) => revision.id === primaryDeliverable.latestRevisionId,
              )?.summary ?? ui.labels.noDeliverable}
            </p>
          </div>
          <div className="stack-card">
            <strong>{locale === "ko" ? "승인 상태" : "Approval Status"}</strong>
            <span className="status status-queued">
              {activeApprovalPackets.length > 0
                ? (locale === "ko" ? `${activeApprovalPackets.length}개 진행 중` : `${activeApprovalPackets.length} active`)
                : formatStatusLabel(latestApprovalPacket?.status ?? "pending", locale)}
            </span>
            <p className="stack-copy">
              {primaryDecision?.summary ?? ui.labels.noDecision}
            </p>
          </div>
        </div>
      </section>
      <section className="detail-block review-evidence">
        <div className="detail-header">
          <p className="section-label">{ui.sections.testAndDelivery}</p>
          <span className="detail-meta">{locale === "ko" ? `${activeRun?.runEvents.length ?? 0}개 이벤트` : `${activeRun?.runEvents.length ?? 0} events`}</span>
        </div>
        <div className="stack-list">
          <DecisionCard
            decision={
              primaryDecision ?? {
                id: "none",
                category: "approval",
                summary: ui.labels.noDecision,
                rationale: locale === "ko" ? "아직 리뷰 결정이 없습니다." : "No review decision has been recorded yet.",
              }
            }
            locale={locale}
          />
          <div className="stack-card">
            <strong>{ui.labels.verificationSignal}</strong>
            <span className="status status-review">
              {testArtifacts.length > 0
                ? (locale === "ko" ? `${testArtifacts.length}개 결과` : `${testArtifacts.length} test artifacts`)
                : (locale === "ko" ? "대기" : "pending")}
            </span>
            <p className="stack-copy">
              {testArtifacts[0]?.preview ?? ui.labels.noTestArtifact}
            </p>
          </div>
          <div className="stack-card">
            <strong>{ui.labels.deliveryPacket}</strong>
            <span className="status status-running">
              {primaryDeliverable?.kind ? formatDeliverableKind(primaryDeliverable.kind, locale) : formatStatusLabel("none", locale)}
            </span>
            <p className="stack-copy">
              {primaryDeliverable?.revisions.find(
                (revision) => revision.id === primaryDeliverable.latestRevisionId,
              )?.summary ?? ui.labels.noDeliverable}
            </p>
          </div>
        </div>
      </section>
      <section className="detail-block review-queue">
        <div className="detail-header">
          <p className="section-label">{ui.sections.approvalQueue}</p>
          <span className="detail-meta">{locale === "ko" ? `${activeApprovalPackets.length}개 진행 중` : `${activeApprovalPackets.length} active`}</span>
        </div>
        <div className="action-stack">
          <div className="stack-card">
            <strong>{ui.labels.approvalPacket}</strong>
            <span className="status status-running">
              {activeApprovalPackets.length > 0
                ? (locale === "ko" ? `${activeApprovalPackets.length}개 진행 중` : `${activeApprovalPackets.length} active`)
                : formatStatusLabel(latestApprovalPacket?.status ?? "pending", locale)}
            </span>
            <p className="stack-copy">
              {latestApprovalPacket?.summary ?? (locale === "ko" ? "아직 승인할 항목이 없습니다." : "No item is ready for approval yet.")}
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
                  <span className="status status-review">{formatStatusLabel(revision.status, locale)}</span>
                  <p className="stack-copy">{revision.summary}</p>
                </div>
              ))}
            </div>
          ) : null}
          <div className="stack-list">
            {recentApprovalHandoffs.map((handoff) => (
              <div className="stack-card" key={handoff.id}>
                <strong>{handoff.channel}</strong>
                <span className="status status-review">{formatStatusLabel(handoff.status, locale)}</span>
                <p className="stack-copy">
                  {locale === "ko"
                    ? `리비전 ${handoff.deliverableRevisionId}${handoff.target ? ` → ${handoff.target}` : ""}`
                    : `Revision ${handoff.deliverableRevisionId}${handoff.target ? ` to ${handoff.target}` : ""}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="detail-block review-history">
        <p className="section-label">{ui.sections.deliverableHistory}</p>
        <div className="stack-list">
          {(activeRun?.deliverables ?? []).map((deliverable) => (
            <div className="stack-card" key={deliverable.id}>
              <strong>{deliverable.title}</strong>
              <span className="status status-review">{formatDeliverableKind(deliverable.kind, locale)}</span>
              <p className="stack-copy">
                {locale === "ko" ? "최신 버전: " : "Latest revision: "}
                {
                  deliverable.revisions.find(
                    (revision) => revision.id === deliverable.latestRevisionId,
                  )?.summary
                }
              </p>
              <div className="revision-list">
                {deliverable.revisions.map((revision) => (
                  <div className="revision-item" key={revision.id}>
                    <strong>v{revision.revision}</strong>
                    <span>{revision.createdAtLabel} • {formatStatusLabel(revision.status, locale)}</span>
                    <p>{revision.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function MonitorScreen({
  activeRun,
  handleSelectRun,
  latestEventByAgentId,
  locale,
  rootRuns,
  followupRuns,
  snapshot,
  ui,
}: {
  activeRun: RunDetail | null;
  handleSelectRun: (runId: string) => Promise<void>;
  latestEventByAgentId: Map<string, RunDetail["runEvents"][number]>;
  locale: Locale;
  rootRuns: RunDetail[];
  followupRuns: RunDetail[];
  snapshot: ShellSnapshot | null;
  ui: UiMessages;
}) {
  const agents = snapshot?.agents ?? [];
  const activeAgents = agents.filter((agent) => agent.status !== "idle");
  const visibleAgents = (activeAgents.length > 0 ? activeAgents : agents).slice(0, 4);
  const hiddenAgentCount = Math.max(0, agents.length - visibleAgents.length);
  const progressAgents = agents.filter(
    (agent) => latestEventByAgentId.has(agent.id) || agent.status !== "idle",
  );
  const visibleProgressAgents = (progressAgents.length > 0 ? progressAgents : agents).slice(0, 4);
  const hiddenProgressCount = Math.max(0, agents.length - visibleProgressAgents.length);
  const currentFollowups = activeRun
    ? followupRuns.filter((child) => child.origin?.parentRunId === activeRun.id)
    : [];
  const visibleFollowups = currentFollowups.slice(0, 2);
  const hiddenFollowupCount = Math.max(0, currentFollowups.length - visibleFollowups.length);

  return (
    <div className="monitor-console">
      <section className="monitor-workspace">
        <div className="detail-block monitor-list-panel">
          <div className="detail-header">
            <p className="section-label">{locale === "ko" ? "에이전트" : "Agents"}</p>
            <span className="detail-meta">{locale === "ko" ? `${snapshot?.agents.length ?? 0}명` : `${snapshot?.agents.length ?? 0} agents`}</span>
          </div>
          <div className="monitor-list">
            {visibleAgents.map((agent) => (
              <div className="monitor-row" key={agent.id}>
                <div className="monitor-row-main">
                  <strong>{agent.name}</strong>
                  <p>{agent.objective}</p>
                </div>
                <div className="monitor-row-meta">
                  <span className={`badge badge-${agent.status}`}>{formatStatusLabel(agent.status, locale)}</span>
                  <small>{agent.role}</small>
                </div>
              </div>
            ))}
            {visibleAgents.length === 0 ? (
              <div className="monitor-empty-row">
                {locale === "ko"
                  ? "선택한 워크스페이스에 아직 에이전트가 없습니다."
                  : "No agents are active in this workspace yet."}
              </div>
            ) : null}
            {hiddenAgentCount > 0 ? (
              <div className="monitor-summary-row">
                {locale === "ko"
                  ? `기타 ${hiddenAgentCount}명은 대기 중이거나 변화가 없습니다.`
                  : `${hiddenAgentCount} more agents are idle or unchanged.`}
              </div>
            ) : null}
          </div>

          <div className="detail-header monitor-subhead">
            <p className="section-label">{locale === "ko" ? "실행 목록" : "Runs"}</p>
            <span className="detail-meta">{rootRuns.length}</span>
          </div>
          <div className="monitor-list">
            {rootRuns.map((run) => (
              <button
                className={`monitor-run-row${activeRun?.id === run.id ? " selected" : ""}`}
                key={run.id}
                onClick={() => {
                  void handleSelectRun(run.id);
                }}
                type="button"
              >
                <div className="monitor-row-main">
                  <strong>{run.title}</strong>
                  <p>{run.summary}</p>
                </div>
                <div className="monitor-row-meta">
                  <span className={`status status-${getStatusTone(run.status)}`}>{formatStatusLabel(run.status, locale)}</span>
                  <small>{run.providerPreference ?? (locale === "ko" ? "미정" : "n/a")}</small>
                </div>
              </button>
            ))}
            {rootRuns.length === 0 ? (
              <div className="monitor-empty-row">
                {locale === "ko"
                  ? "선택한 워크스페이스에 아직 실행이 없습니다. 홈에서 미션을 만들면 여기 나타납니다."
                  : "No runs yet for this workspace. Create a mission from Home to start one."}
              </div>
            ) : null}
          </div>
        </div>

        <div className="detail-block monitor-detail-panel">
          {activeRun ? (
            <>
              <div className="monitor-detail-header">
                <div>
                  <h4>{activeRun.title}</h4>
                </div>
                <span className={`status status-${getStatusTone(activeRun.status)}`}>
                  {formatStatusLabel(activeRun.status, locale)}
                </span>
              </div>

              <div className="monitor-detail-grid">
                <div className="monitor-detail-box">
                  <span>{locale === "ko" ? "실행 환경" : "Run Setup"}</span>
                  <strong>
                    {(activeRun.providerPreference ?? (locale === "ko" ? "미정" : "n/a"))}
                    {" • "}
                    {(activeRun.budgetClass ?? (locale === "ko" ? "기본" : "default"))}
                  </strong>
                </div>
                <div className="monitor-detail-box">
                  <span>{locale === "ko" ? "이벤트 수" : "Events"}</span>
                  <strong>{activeRun.runEvents.length}</strong>
                </div>
                <div className="monitor-detail-box">
                  <span>{locale === "ko" ? "산출물 수" : "Artifacts"}</span>
                  <strong>{activeRun.artifacts.length}</strong>
                </div>
              </div>

              <div className="monitor-split">
                <div className="monitor-pane">
                  <div className="detail-header monitor-subhead">
                    <p className="section-label">{locale === "ko" ? "현재 진행 상황" : "Current Progress"}</p>
                    <span className="detail-meta">{locale === "ko" ? "에이전트별" : "by agent"}</span>
                  </div>
                  <div className="monitor-list">
                    {visibleProgressAgents.map((agent) => {
                      const latest = latestEventByAgentId.get(agent.id);
                      return (
                        <div className="monitor-row compact" key={agent.id}>
                          <div className="monitor-row-main">
                            <strong>{agent.name}</strong>
                            <p>{latest?.summary ?? (locale === "ko" ? "최근 이벤트 없음" : "No recent event")}</p>
                          </div>
                          <div className="monitor-row-meta">
                            <small>{latest ? formatEventKind(latest.kind, locale) : ""}</small>
                          </div>
                        </div>
                      );
                    })}
                    {hiddenProgressCount > 0 ? (
                      <div className="monitor-summary-row">
                        {locale === "ko"
                          ? `기타 ${hiddenProgressCount}명은 변화가 없어 생략했습니다.`
                          : `${hiddenProgressCount} more agents have no recent updates.`}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="monitor-pane">
                  <div className="detail-header monitor-subhead">
                    <p className="section-label">{locale === "ko" ? "후속 실행" : "Follow-up Runs"}</p>
                    <span className="detail-meta">
                      {currentFollowups.length}
                    </span>
                  </div>
                  <div className="monitor-list">
                    {visibleFollowups.map((child) => (
                        <button
                          className={`monitor-run-row compact${activeRun?.id === child.id ? " selected" : ""}`}
                          key={child.id}
                          onClick={() => {
                            void handleSelectRun(child.id);
                          }}
                          type="button"
                        >
                          <div className="monitor-row-main">
                            <strong>{child.title}</strong>
                            <p>{child.summary}</p>
                          </div>
                          <div className="monitor-row-meta">
                            <span className={`status status-${getStatusTone(child.status)}`}>{formatStatusLabel(child.status, locale)}</span>
                            <small>{child.origin?.schedulerRuleId ?? (locale === "ko" ? "수동" : "manual")}</small>
                          </div>
                        </button>
                      ))}
                    {hiddenFollowupCount > 0 ? (
                      <div className="monitor-summary-row">
                        {locale === "ko"
                          ? `기타 ${hiddenFollowupCount}개 후속 실행은 생략했습니다.`
                          : `${hiddenFollowupCount} more follow-up runs are hidden.`}
                      </div>
                    ) : null}
                    {currentFollowups.length === 0 ? (
                      <div className="monitor-row compact">
                        <div className="monitor-row-main">
                          <strong>{locale === "ko" ? "후속 실행 없음" : "No follow-up runs"}</strong>
                          <p>{locale === "ko" ? "이 실행에서 파생된 후속 실행이 없습니다." : "No child runs were created from this run."}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="monitor-empty">
              <strong>{locale === "ko" ? "선택된 실행이 없습니다." : "No run selected."}</strong>
              <p>{locale === "ko" ? "왼쪽 목록에서 실행을 선택하면 상세 정보가 여기에 표시됩니다." : "Select a run from the list to see details here."}</p>
            </div>
          )}
        </div>
      </section>
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

function DecisionCard({ decision, locale = "ko" }: { decision: DecisionRecord; locale?: Locale }) {
  return (
    <div className="stack-card">
      <strong>{decision.summary}</strong>
      <span className="status status-review">
        {formatDecisionCategory(decision.category, locale)}
      </span>
      <p className="stack-copy">{decision.rationale}</p>
    </div>
  );
}

function getStatusTone(status: string): "running" | "queued" | "blocked" | "review" {
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "blocked") return "blocked";
  return "review";
}

function getAttentionTone(kind: string): "blocked" | "review" | "queued" {
  if (kind === "blocked") return "blocked";
  if (kind === "steering_requested") return "queued";
  return "review";
}

function formatStatusLabel(status: string, locale: Locale): string {
  const ko: Record<string, string> = {
    idle: "대기",
    queued: "대기 중",
    running: "진행 중",
    blocked: "중단됨",
    review: "검토 필요",
    needs_review: "검토 필요",
    completed: "완료",
    active: "진행 중",
    approved: "승인됨",
    superseded: "대체됨",
    resolved: "해결됨",
    ready: "준비됨",
    busy: "사용 중",
    cooldown: "대기 중",
    unavailable: "사용 불가",
    none: "없음",
    pending: "대기",
  };
  const en: Record<string, string> = {
    idle: "Idle",
    queued: "Queued",
    running: "Running",
    blocked: "Blocked",
    review: "Needs Review",
    needs_review: "Needs Review",
    completed: "Completed",
    active: "Active",
    approved: "Approved",
    superseded: "Superseded",
    resolved: "Resolved",
    ready: "Ready",
    busy: "Busy",
    cooldown: "Cooldown",
    unavailable: "Unavailable",
    none: "None",
    pending: "Pending",
  };
  return (locale === "ko" ? ko : en)[status] ?? status;
}

function formatEventKind(kind: string, locale: Locale): string {
  const ko: Record<string, string> = {
    none: "없음",
    artifact_created: "산출물 생성",
    blocked: "중단",
    agent_status_changed: "에이전트 상태 변경",
    needs_review: "검토 필요",
    review_requested: "리뷰 요청",
    steering_requested: "입력 요청",
    steering_submitted: "입력 전송",
    completed: "완료",
  };
  const en: Record<string, string> = {
    none: "None",
    artifact_created: "Artifact Created",
    blocked: "Blocked",
    agent_status_changed: "Agent Status Changed",
    needs_review: "Needs Review",
    review_requested: "Review Requested",
    steering_requested: "Input Requested",
    steering_submitted: "Input Sent",
    completed: "Completed",
  };
  return (locale === "ko" ? ko : en)[kind] ?? kind;
}

function formatArtifactType(type: ArtifactRecord["type"], locale: Locale): string {
  const ko: Record<ArtifactRecord["type"], string> = {
    diff: "코드 변경",
    report: "리포트",
    test_result: "테스트 결과",
    handoff: "전달 자료",
  };
  const en: Record<ArtifactRecord["type"], string> = {
    diff: "Diff",
    report: "Report",
    test_result: "Test Result",
    handoff: "Handoff",
  };
  return (locale === "ko" ? ko : en)[type];
}

function formatDeliverableKind(kind: RunDetail["deliverables"][number]["kind"], locale: Locale): string {
  const ko: Record<RunDetail["deliverables"][number]["kind"], string> = {
    release_brief: "배포 요약",
    review_packet: "리뷰 자료",
    merge_handoff: "병합 전달",
    deployment_note: "배포 메모",
  };
  const en: Record<RunDetail["deliverables"][number]["kind"], string> = {
    release_brief: "Release Brief",
    review_packet: "Review Packet",
    merge_handoff: "Merge Handoff",
    deployment_note: "Deployment Note",
  };
  return (locale === "ko" ? ko : en)[kind];
}

function formatDecisionCategory(category: DecisionRecord["category"], locale: Locale): string {
  const ko: Record<DecisionRecord["category"], string> = {
    planning: "계획",
    technical: "기술",
    risk: "리스크",
    approval: "승인",
    orchestration: "조정",
  };
  const en: Record<DecisionRecord["category"], string> = {
    planning: "Planning",
    technical: "Technical",
    risk: "Risk",
    approval: "Approval",
    orchestration: "Orchestration",
  };
  return (locale === "ko" ? ko : en)[category];
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
