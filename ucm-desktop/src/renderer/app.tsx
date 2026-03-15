import { useEffect, useRef, useState } from "react";
import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  ArtifactRecord,
  DecisionRecord,
  HandoffRecord,
  MissionDetail,
  MissionSnapshot,
  RunAutopilotResult,
  RunDetail,
  RuntimeUpdateEvent,
  ShellSnapshot,
  WorkspaceBrowserSnapshot,
  WorkspaceSummary,
} from "@shared/contracts";

type Locale = "ko" | "en";
type MissionTab = "overview" | "runs" | "releases" | "notes";
type RunSurface = "diff" | "trace";
type ReleaseRecord = RunDetail["releases"][number];
type ReleaseRevision = ReleaseRecord["revisions"][number];
type FilePatch = NonNullable<ArtifactRecord["filePatches"]>[number];

type ReleaseEntry = {
  key: string;
  run: RunDetail;
  release: ReleaseRecord;
  latestRevision: ReleaseRevision | null;
  activeRevisions: ReleaseRevision[];
  handoffs: HandoffRecord[];
};

const copy = {
  ko: {
    header: {
      label: "Mission Console",
      workspace: "현재 워크스페이스",
      mission: "활성 미션",
      providers: "프로바이더",
      agents: "에이전트",
      blocked: "막힘",
      review: "리뷰",
    },
    rail: {
      workspaces: "워크스페이스",
      inbox: "워크스페이스 인박스",
      missions: "미션",
      composer: "새 미션",
      blockedMissions: "막힌 미션",
      reviewQueue: "리뷰 대기열",
      recentHandoffs: "최근 핸드오프",
      noBlockedMissions: "막힌 미션이 없습니다.",
      noReviewQueue: "대기 중인 리뷰가 없습니다.",
      noRecentHandoffs: "최근 핸드오프가 없습니다.",
      addWorkspace: "워크스페이스 추가",
      active: "사용 중",
      available: "선택 가능",
    },
    mission: {
      untitled: "선택된 미션 없음",
      noMission: "활성 미션이 없습니다. 왼쪽에서 워크스페이스를 고르고 새 미션을 시작하세요.",
      goal: "목표",
      successCriteria: "성공 기준",
      constraints: "제약",
      phases: "단계",
      agents: "팀",
      risks: "리스크",
      decisions: "결정",
      notes: "노트",
      artifacts: "산출물",
      timeline: "라이프사이클",
      status: "상태",
      runCount: "실행",
      releaseCount: "릴리즈",
      latestRun: "최신 실행",
      latestRelease: "최신 릴리즈",
      noDetail: "미션 상세 정보가 아직 없습니다.",
      noGoal: "설정된 목표가 없습니다.",
      noPhases: "정의된 단계가 없습니다.",
      noCriteria: "성공 기준이 아직 없습니다.",
      noConstraints: "기록된 제약이 없습니다.",
      noRisks: "기록된 리스크가 없습니다.",
      noDecisions: "기록된 결정이 없습니다.",
      noArtifacts: "표시할 산출물이 없습니다.",
      noLifecycle: "라이프사이클 이벤트가 없습니다.",
    },
    tabs: {
      overview: "개요",
      runs: "실행",
      releases: "릴리즈",
      notes: "노트",
    },
    runs: {
      label: "실행 흐름",
      rootRuns: "루트 실행",
      followups: "후속 실행",
      runStatus: "실행 상태",
      userAttention: "사용자 확인",
      outputs: "출력",
      changedFiles: "변경 파일",
      patch: "패치",
      trace: "추적",
      patchSurface: "패치 표면",
      executionTrace: "실행 추적",
      terminalTrace: "터미널 추적",
      artifactTrace: "산출물 추적",
      runLineage: "실행 흐름",
      steeringInbox: "Steering Inbox",
      missionPressure: "현재 상태",
      providerWindows: "프로바이더 상태",
      emergencyStop: "긴급 중지",
      noRun: "선택된 실행이 없습니다. 실행 목록에서 고르세요.",
      noChangedFiles: "아직 변경 파일이 없습니다.",
      noDiffPreview: "패치 미리보기가 아직 없습니다.",
      noTerminal: "실시간 터미널이 없습니다.",
      noArtifacts: "기록된 산출물이 없습니다.",
      noTrace: "기록된 실행 이벤트가 없습니다.",
      noFollowups: "이 실행에서 파생된 후속 실행이 없습니다.",
      noParent: "부모 실행이 없습니다.",
      noSteering: "현재 요청된 steering이 없습니다.",
      steeringPlaceholder: "예: checkout 회귀 테스트용 fallback fixture를 사용",
      stopSession: "세션 중지",
      retryRun: "다시 실행",
      submitSteering: "Steering 보내기",
      autopilot: "자동 진행 상태",
      providerLabel: "실행 환경",
      parentRun: "부모 실행",
      childRuns: "자식 실행",
      lastEvent: "최근 이벤트",
      budget: "실행 예산",
    },
    releases: {
      label: "릴리즈",
      history: "릴리즈 이력",
      evidence: "근거",
      approval: "승인",
      handoff: "핸드오프",
      noRelease: "이 미션에는 아직 릴리즈가 없습니다.",
      noRevision: "활성 릴리즈 버전이 없습니다.",
      noHandoff: "기록된 핸드오프가 없습니다.",
      noEvidence: "릴리즈에 묶인 산출물이 없습니다.",
      latestVersion: "최신 버전",
      activeVersions: "진행 중 버전",
      generate: "새 버전 생성",
      sendInbox: "인박스로 전달",
      export: "내보내기",
      approveLatest: "최신본 승인",
      generated: "현재 실행 상태를 기반으로 새 릴리즈 버전을 만듭니다.",
      sendHelp: "가장 최신 릴리즈 버전을 human reviewer 인박스로 넘깁니다.",
      exportHelp: "현재 릴리즈 버전을 export 기록으로 남깁니다.",
      approveHelp: "활성 릴리즈 버전을 승인하고 실행을 마감합니다.",
    },
    notes: {
      label: "노트",
      decisions: "결정 기록",
      artifacts: "핵심 산출물",
      lifecycle: "라이프사이클",
      noDecisions: "표시할 결정 기록이 없습니다.",
      noArtifacts: "표시할 산출물이 없습니다.",
      noLifecycle: "표시할 라이프사이클 이벤트가 없습니다.",
    },
    composer: {
      title: "새 미션 시작",
      subtitle: "워크스페이스를 기준으로 미션을 만들고 바로 실행까지 연결합니다.",
      missionTitle: "미션 제목",
      goal: "목표",
      command: "작업 명령",
      launchMode: "실행 방식",
      commandMode: "입력한 명령을 바로 실행합니다:",
      planMode: "명령 없이 미션을 만들고 계획부터 시작합니다.",
      createMission: "미션 생성",
      titlePlaceholder: "예: 결제 인증 회귀 오류 수정",
      goalPlaceholder: "예: 인증 흐름을 깨지 않고 결제 안정성을 복구",
      commandPlaceholder: "예: npm test 또는 npm run build",
    },
    empty: {
      workspace: "워크스페이스가 없습니다. 먼저 프로젝트 폴더를 추가하세요.",
      mission: "활성 미션이 없습니다.",
      runs: "활성 실행이 없습니다.",
    },
    settings: {
      label: "환경",
      language: "언어",
      korean: "한국어",
      english: "영어",
      guidance: "전역 설정은 메인 흐름을 방해하지 않고 오른쪽 컨텍스트 패널에서만 다룹니다.",
    },
    status: {
      active: "진행 중",
      pending: "대기",
    },
    templates: {
      bugfix: "버그 수정",
      verify: "검증 실행",
      plan: "계획만 시작",
    },
  },
  en: {
    header: {
      label: "Mission Console",
      workspace: "Workspace",
      mission: "Active Mission",
      providers: "Providers",
      agents: "Agents",
      blocked: "Blocked",
      review: "Review",
    },
    rail: {
      workspaces: "Workspaces",
      inbox: "Workspace Inbox",
      missions: "Missions",
      composer: "New Mission",
      blockedMissions: "Blocked Missions",
      reviewQueue: "Review Queue",
      recentHandoffs: "Recent Handoffs",
      noBlockedMissions: "No blocked missions.",
      noReviewQueue: "Nothing is waiting for review.",
      noRecentHandoffs: "No recent handoffs.",
      addWorkspace: "Add Workspace",
      active: "active",
      available: "available",
    },
    mission: {
      untitled: "No active mission",
      noMission: "No mission is active. Pick a workspace on the left and start a new mission.",
      goal: "Goal",
      successCriteria: "Success Criteria",
      constraints: "Constraints",
      phases: "Phases",
      agents: "Team",
      risks: "Risks",
      decisions: "Decisions",
      notes: "Notes",
      artifacts: "Artifacts",
      timeline: "Lifecycle",
      status: "Status",
      runCount: "Runs",
      releaseCount: "Releases",
      latestRun: "Latest Run",
      latestRelease: "Latest Release",
      noDetail: "Mission detail has not been loaded yet.",
      noGoal: "No goal is recorded yet.",
      noPhases: "No phases are defined yet.",
      noCriteria: "No success criteria are recorded yet.",
      noConstraints: "No constraints are recorded yet.",
      noRisks: "No risks are recorded yet.",
      noDecisions: "No decisions are recorded yet.",
      noArtifacts: "No artifacts are available.",
      noLifecycle: "No lifecycle events are available.",
    },
    tabs: {
      overview: "Overview",
      runs: "Runs",
      releases: "Releases",
      notes: "Notes",
    },
    runs: {
      label: "Run Flow",
      rootRuns: "Root Runs",
      followups: "Follow-up Runs",
      runStatus: "Run Status",
      userAttention: "User Attention",
      outputs: "Outputs",
      changedFiles: "Changed Files",
      patch: "Patch",
      trace: "Trace",
      patchSurface: "Patch Surface",
      executionTrace: "Execution Trace",
      terminalTrace: "Terminal Trace",
      artifactTrace: "Artifact Trace",
      runLineage: "Run Lineage",
      steeringInbox: "Steering Inbox",
      missionPressure: "Current Status",
      providerWindows: "Provider Status",
      emergencyStop: "Emergency Stop",
      noRun: "No run is selected. Choose one from the run list.",
      noChangedFiles: "No changed files yet.",
      noDiffPreview: "No diff preview is available yet.",
      noTerminal: "No live terminal session is attached.",
      noArtifacts: "No artifacts are recorded yet.",
      noTrace: "No execution events are recorded yet.",
      noFollowups: "No follow-up runs were created from this run.",
      noParent: "No parent run.",
      noSteering: "No steering is currently requested.",
      steeringPlaceholder: "Example: use the checkout fallback fixture for the regression test",
      stopSession: "Stop Session",
      retryRun: "Run Again",
      submitSteering: "Send Steering",
      autopilot: "Automation",
      providerLabel: "Run Setup",
      parentRun: "Parent Run",
      childRuns: "Child Runs",
      lastEvent: "Last Event",
      budget: "Budget",
    },
    releases: {
      label: "Releases",
      history: "Release History",
      evidence: "Evidence",
      approval: "Approval",
      handoff: "Handoff",
      noRelease: "No releases exist for this mission yet.",
      noRevision: "No release version is active.",
      noHandoff: "No handoffs are recorded yet.",
      noEvidence: "No artifacts are attached to this release.",
      latestVersion: "Latest Version",
      activeVersions: "Active Versions",
      generate: "Generate Version",
      sendInbox: "Send to Inbox",
      export: "Export",
      approveLatest: "Approve Latest",
      generated: "Generate a fresh release version from the current run state.",
      sendHelp: "Hand off the latest release version to the human reviewer inbox.",
      exportHelp: "Record an export handoff for the current release version.",
      approveHelp: "Approve the latest release version and complete the run.",
    },
    notes: {
      label: "Notes",
      decisions: "Decision Log",
      artifacts: "Key Artifacts",
      lifecycle: "Lifecycle",
      noDecisions: "No decisions are recorded yet.",
      noArtifacts: "No artifacts are available yet.",
      noLifecycle: "No lifecycle events are available yet.",
    },
    composer: {
      title: "Start a New Mission",
      subtitle: "Create work from a workspace and connect it to execution immediately.",
      missionTitle: "Mission title",
      goal: "Goal",
      command: "Workspace command",
      launchMode: "Launch mode",
      commandMode: "Run this command immediately:",
      planMode: "Create the mission without a command and start from planning.",
      createMission: "Create Mission",
      titlePlaceholder: "Example: Fix checkout auth regression",
      goalPlaceholder: "Example: Restore checkout stability without breaking auth flow",
      commandPlaceholder: "Example: npm test or npm run build",
    },
    empty: {
      workspace: "No workspaces are registered yet. Add a project folder first.",
      mission: "No mission is active.",
      runs: "No active run.",
    },
    settings: {
      label: "Environment",
      language: "Language",
      korean: "Korean",
      english: "English",
      guidance: "Global settings stay in the right context rail so they do not fragment the main workflow.",
    },
    status: {
      active: "Active",
      pending: "Pending",
    },
    templates: {
      bugfix: "Bug Fix",
      verify: "Verify",
      plan: "Plan Only",
    },
  },
} as const;

type UiCopy = (typeof copy)[Locale];

const missionTemplates = {
  ko: [
    {
      id: "bugfix",
      label: copy.ko.templates.bugfix,
      title: "결제 회귀 오류 수정",
      goal: "최근 변경 이후 깨진 결제 흐름을 복구하고 영향 범위를 확인합니다.",
      command: "npm test",
    },
    {
      id: "verify",
      label: copy.ko.templates.verify,
      title: "현재 상태 검증",
      goal: "선택한 워크스페이스의 현재 상태를 빠르게 확인하고 실패 지점을 수집합니다.",
      command: "npm run build",
    },
    {
      id: "plan",
      label: copy.ko.templates.plan,
      title: "배포 전 정리",
      goal: "배포 전에 남은 위험과 확인 항목을 정리합니다.",
      command: "",
    },
  ],
  en: [
    {
      id: "bugfix",
      label: copy.en.templates.bugfix,
      title: "Fix checkout regression",
      goal: "Restore the broken checkout path and confirm the blast radius.",
      command: "npm test",
    },
    {
      id: "verify",
      label: copy.en.templates.verify,
      title: "Verify current state",
      goal: "Check the selected workspace and collect the first failing signal.",
      command: "npm run build",
    },
    {
      id: "plan",
      label: copy.en.templates.plan,
      title: "Prepare release review",
      goal: "Organize the remaining risks and review items before release.",
      command: "",
    },
  ],
} as const;

function App() {
  const [version, setVersion] = useState("...");
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
  const [activeTab, setActiveTab] = useState<MissionTab>("runs");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [command, setCommand] = useState("");
  const [steeringInput, setSteeringInput] = useState("");
  const [selectedPatchPath, setSelectedPatchPath] = useState<string | null>(null);
  const [runSurface, setRunSurface] = useState<RunSurface>("diff");
  const [selectedReleaseKey, setSelectedReleaseKey] = useState<string | null>(null);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [isWorkspaceAddModalOpen, setIsWorkspaceAddModalOpen] = useState(false);
  const [isWorkspaceBrowserBusy, setIsWorkspaceBrowserBusy] = useState(false);
  const [workspaceBrowser, setWorkspaceBrowser] = useState<WorkspaceBrowserSnapshot | null>(null);
  const [workspaceBrowserPathDraft, setWorkspaceBrowserPathDraft] = useState("");
  const [workspaceBrowserError, setWorkspaceBrowserError] = useState("");
  const [workspaceDirectoryName, setWorkspaceDirectoryName] = useState("");
  const [workspacePathDraft, setWorkspacePathDraft] = useState("");
  const [workspacePathError, setWorkspacePathError] = useState("");
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const [autopilotResult, setAutopilotResult] = useState<RunAutopilotResult>({
    run: null,
    eventKind: "none",
    decision: "observe",
    summary: "다음 실행 이벤트를 기다리는 중입니다.",
  });

  async function refresh() {
    const [
      nextSnapshot,
      nextWorkspaces,
      nextMissions,
      nextVersion,
      nextActiveMission,
      nextActiveRun,
      nextMissionRuns,
    ] = await Promise.all([
      window.ucm.shell.getSnapshot(),
      window.ucm.workspace.list(),
      window.ucm.mission.list(),
      window.ucm.app.getVersion(),
      window.ucm.mission.getActive(),
      window.ucm.run.getActive(),
      window.ucm.run.listForActiveMission(),
    ]);

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
    setRunSurface("diff");
  }, [activeRun?.id]);

  useEffect(() => {
    if (
      !isComposerOpen &&
      !isContextOpen &&
      !isReleaseModalOpen &&
      !isWorkspaceMenuOpen &&
      !isWorkspaceAddModalOpen
    ) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setIsWorkspaceMenuOpen(false);
      setIsWorkspaceAddModalOpen(false);
      setIsComposerOpen(false);
      setIsContextOpen(false);
      setIsReleaseModalOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isComposerOpen,
    isContextOpen,
    isReleaseModalOpen,
    isWorkspaceAddModalOpen,
    isWorkspaceMenuOpen,
  ]);

  useEffect(() => {
    if (!isWorkspaceMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (workspaceMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsWorkspaceMenuOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isWorkspaceMenuOpen]);

  useEffect(() => {
    if (!isWorkspaceAddModalOpen) {
      return;
    }

    let isDisposed = false;
    setIsWorkspaceBrowserBusy(true);
    setWorkspaceBrowserError("");

    void window.ucm.workspace
      .browse()
      .then((nextBrowser) => {
        if (isDisposed) {
          return;
        }
        setWorkspaceBrowser(nextBrowser);
        setWorkspaceBrowserPathDraft(nextBrowser.currentPath);
        setWorkspacePathDraft(nextBrowser.currentPath);
        setWorkspacePathError("");
      })
      .catch((error) => {
        if (isDisposed) {
          return;
        }
        setWorkspaceBrowserError(getWorkspaceBrowserErrorMessage(error));
      })
      .finally(() => {
        if (!isDisposed) {
          setIsWorkspaceBrowserBusy(false);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [isWorkspaceAddModalOpen, locale]);

  const releaseEntries = missionRuns.flatMap((run) =>
    run.releases.map((release) => {
      const releaseRevisionIds = new Set(release.revisions.map((revision) => revision.id));
      return {
        key: `${run.id}:${release.id}`,
        run,
        release,
        latestRevision:
          release.revisions.find((revision) => revision.id === release.latestRevisionId) ??
          release.revisions.at(-1) ??
          null,
        activeRevisions: release.revisions.filter((revision) => revision.status === "active"),
        handoffs: run.handoffs.filter((handoff) =>
          releaseRevisionIds.has(handoff.releaseRevisionId),
        ),
      } satisfies ReleaseEntry;
    }),
  );

  useEffect(() => {
    if (releaseEntries.length === 0) {
      if (selectedReleaseKey !== null) {
        setSelectedReleaseKey(null);
      }
      if (isReleaseModalOpen) {
        setIsReleaseModalOpen(false);
      }
      return;
    }

    if (
      selectedReleaseKey &&
      releaseEntries.some((entry) => entry.key === selectedReleaseKey)
    ) {
      return;
    }

    setSelectedReleaseKey(releaseEntries[0].key);
  }, [isReleaseModalOpen, releaseEntries, selectedReleaseKey]);

  async function handleCreateMission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeWorkspace = workspaces.find((workspace) => workspace.active);
    if (!activeWorkspace || !title.trim() || !goal.trim()) {
      return;
    }

    await window.ucm.mission.create({
      workspaceId: activeWorkspace.id,
      title,
      goal,
      command,
    });

    setTitle("");
    setGoal("");
    setCommand("");
    setActiveTab(command.trim() ? "runs" : "overview");
    setIsComposerOpen(false);
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
    setIsWorkspaceMenuOpen(false);
    setActiveTab("overview");
    await refresh();
  }

  function getWorkspaceBrowserErrorMessage(error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "invalid_directory_name") {
      return locale === "ko"
        ? "새 폴더 이름에 슬래시나 점만 입력할 수는 없습니다."
        : "Folder names cannot be empty, dot-only, or include slashes.";
    }
    if (code === "directory_exists") {
      return locale === "ko"
        ? "같은 이름의 폴더가 이미 있습니다."
        : "A folder with the same name already exists.";
    }
    return locale === "ko"
      ? "폴더 작업을 완료하지 못했습니다."
      : "The folder action could not be completed.";
  }

  async function loadWorkspaceBrowser(rootPath?: string, options?: {
    selectCurrentPath?: boolean;
  }) {
    setIsWorkspaceBrowserBusy(true);
    setWorkspaceBrowserError("");
    try {
      const nextBrowser = await window.ucm.workspace.browse(
        rootPath?.trim() ? { rootPath } : undefined,
      );
      setWorkspaceBrowser(nextBrowser);
      setWorkspaceBrowserPathDraft(nextBrowser.currentPath);
      if (options?.selectCurrentPath) {
        setWorkspacePathDraft(nextBrowser.currentPath);
        setWorkspacePathError("");
      }
      return nextBrowser;
    } catch (error) {
      setWorkspaceBrowserError(getWorkspaceBrowserErrorMessage(error));
      return null;
    } finally {
      setIsWorkspaceBrowserBusy(false);
    }
  }

  async function handleBrowseWorkspacePath(rootPath?: string, options?: {
    selectCurrentPath?: boolean;
  }) {
    await loadWorkspaceBrowser(rootPath, options);
  }

  async function handleCreateWorkspaceDirectory(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!workspaceBrowser) {
      return;
    }

    setIsWorkspaceBrowserBusy(true);
    setWorkspaceBrowserError("");
    try {
      const nextBrowser = await window.ucm.workspace.createDirectory({
        parentPath: workspaceBrowser.currentPath,
        directoryName: workspaceDirectoryName,
      });
      setWorkspaceBrowser(nextBrowser);
      setWorkspaceBrowserPathDraft(nextBrowser.currentPath);
      setWorkspacePathDraft(nextBrowser.currentPath);
      setWorkspacePathError("");
      setWorkspaceDirectoryName("");
    } catch (error) {
      setWorkspaceBrowserError(getWorkspaceBrowserErrorMessage(error));
    } finally {
      setIsWorkspaceBrowserBusy(false);
    }
  }

  async function handleAddWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedInput = workspacePathDraft.trim().replace(/[\\/]+$/, "");
    if (!normalizedInput) {
      setWorkspacePathError(
        locale === "ko"
          ? "워크스페이스 경로를 입력하세요."
          : "Enter a workspace path.",
      );
      return;
    }

    try {
      await window.ucm.workspace.add({ rootPath: normalizedInput });
    } catch {
      setWorkspacePathError(
        locale === "ko"
          ? "유효한 폴더 경로를 입력하세요."
          : "Enter a valid folder path.",
      );
      return;
    }

    setWorkspacePathDraft("");
    setWorkspacePathError("");
    setWorkspaceBrowser(null);
    setWorkspaceBrowserError("");
    setWorkspaceBrowserPathDraft("");
    setWorkspaceDirectoryName("");
    setIsWorkspaceMenuOpen(false);
    setIsWorkspaceAddModalOpen(false);
    await refresh();
  }

  async function handleOpenMission(missionId: string, nextTab: MissionTab = "overview") {
    await window.ucm.mission.setActive({ missionId });
    setActiveTab(nextTab);
    await refresh();
  }

  async function handleSelectRun(runId: string) {
    await window.ucm.run.setActive({ runId });
    setActiveTab("runs");
    await refresh();
  }

  async function handleRetryRun(runId: string) {
    await window.ucm.run.retry({ runId });
    setActiveTab("runs");
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
    setActiveTab("runs");
    await refresh();
  }

  async function handleTerminalStop() {
    if (!activeRun?.terminalSessionId) {
      return;
    }
    await window.ucm.run.terminalKill({
      sessionId: activeRun.terminalSessionId,
    });
    await refresh();
  }

  async function handleSelectRelease(
    entry: ReleaseEntry,
    options?: { openModal?: boolean },
  ) {
    setSelectedReleaseKey(entry.key);
    if (activeRun?.id !== entry.run.id) {
      await window.ucm.run.setActive({ runId: entry.run.id });
      await refresh();
    }
    setActiveTab("releases");
    if (options?.openModal) {
      setIsReleaseModalOpen(true);
    }
  }

  async function handleGenerateRelease() {
    const selectedRelease = releaseEntries.find((entry) => entry.key === selectedReleaseKey);
    if (!selectedRelease) {
      return;
    }

    await window.ucm.release.generate({
      runId: selectedRelease.run.id,
      releaseId: selectedRelease.release.id,
      summary: buildReleaseSummary(selectedRelease.run, locale),
    });
    setActiveTab("releases");
    await refresh();
  }

  async function handleHandoffRelease(channel: HandoffRecord["channel"]) {
    const selectedRelease = releaseEntries.find((entry) => entry.key === selectedReleaseKey);
    const revisionId = selectedRelease?.latestRevision?.id;
    if (!selectedRelease || !revisionId) {
      return;
    }

    await window.ucm.release.handoff({
      runId: selectedRelease.run.id,
      releaseRevisionId: revisionId,
      channel,
      target: channel === "export" ? "release-export" : "human reviewer",
    });
    setActiveTab("releases");
    await refresh();
  }

  async function handleApproveRelease(revisionId: string) {
    if (!activeRun?.id) {
      return;
    }

    await window.ucm.release.approve({
      runId: activeRun.id,
      releaseRevisionId: revisionId,
    });
    setActiveTab("releases");
    await refresh();
  }

  const ui = copy[locale];
  const activeWorkspace = workspaces.find((workspace) => workspace.active) ?? null;
  const selectedMissionTitle =
    activeMission?.title ??
    snapshot?.missionName ??
    ui.mission.untitled;
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
    (event) =>
      event.metadata?.status === "resolved" ||
      event.metadata?.status === "superseded",
  );
  const missionAgents = snapshot?.agents ?? [];
  const lifecycleEvents = snapshot?.lifecycleEvents ?? [];
  const blockedMissions = missions.filter(
    (mission) =>
      mission.status === "blocked" ||
      mission.lineStatus === "blocked" ||
      mission.attentionRequired,
  );
  const reviewQueue = releaseEntries.filter(
    (entry) =>
      entry.activeRevisions.length > 0 ||
      entry.run.status === "needs_review" ||
      entry.run.status === "blocked",
  );
  const recentHandoffs = [...releaseEntries.flatMap((entry) => entry.handoffs)]
    .slice(-4)
    .reverse();
  const rootRuns = missionRuns.filter((run) => !run.origin?.parentRunId);
  const followupRuns = missionRuns.filter((run) => Boolean(run.origin?.parentRunId));
  const currentFollowups = activeRun
    ? followupRuns.filter((run) => run.origin?.parentRunId === activeRun.id)
    : [];
  const activeRunParent = activeRun?.origin?.parentRunId
    ? missionRuns.find((run) => run.id === activeRun.origin?.parentRunId) ?? null
    : null;
  const changedFiles = (activeRun?.artifacts ?? [])
    .filter((artifact) => artifact.type === "diff")
    .flatMap((artifact) => getChangedFilesForArtifact(artifact));
  const diffArtifact =
    (activeRun?.artifacts ?? []).find((artifact) => artifact.type === "diff") ?? null;
  const diffFilePatches = diffArtifact ? getFilePatchesForArtifact(diffArtifact) : [];
  const selectedPatch =
    diffFilePatches.find((patch) => patch.path === selectedPatchPath) ??
    diffFilePatches[0] ??
    null;
  const primaryDecision = activeRun?.decisions.at(-1) ?? null;
  const selectedReleaseEntry =
    releaseEntries.find((entry) => entry.key === selectedReleaseKey) ?? releaseEntries[0] ?? null;
  const latestApprovalPacket = selectedReleaseEntry?.latestRevision ?? null;
  const activeApprovalPackets = selectedReleaseEntry?.activeRevisions ?? [];
  const attentionItems = lifecycleEvents.filter((event) =>
    ["blocked", "reviewing", "queued"].includes(event.kind),
  );
  const missionSummaryCards = [
    {
      label: ui.mission.status,
      value: formatStatusLabel(activeMission?.status ?? "none", locale),
      tone: getStatusTone(activeMission?.status ?? "queued"),
    },
    {
      label: ui.mission.runCount,
      value: String(missionRuns.length),
      tone: "queued",
    },
    {
      label: ui.mission.releaseCount,
      value: String(releaseEntries.length),
      tone: "review",
    },
  ];

  const mainContent = !activeMission ? (
    <EmptyMissionState
      activeWorkspace={activeWorkspace}
      locale={locale}
      ui={ui}
    />
  ) : (
    <>
      <section className="mission-shell-card">
        <div className="mission-shell-head">
          <div className="mission-shell-copy">
            <p className="eyebrow">{ui.header.mission}</p>
            <h2>{activeMission.title}</h2>
            <p>{activeMission.goal || ui.mission.noGoal}</p>
          </div>
          <div className="mission-shell-metrics">
            {missionSummaryCards.map((card) => (
              <MetricTile
                key={card.label}
                label={card.label}
                tone={card.tone}
                value={card.value}
              />
            ))}
          </div>
        </div>
        <div className="tab-strip" role="tablist" aria-label="mission views">
          {(
            [
              ["overview", ui.tabs.overview],
              ["runs", ui.tabs.runs],
              ["releases", ui.tabs.releases],
              ["notes", ui.tabs.notes],
            ] satisfies Array<[MissionTab, string]>
          ).map(([tabId, label]) => (
            <button
              key={tabId}
              className={tabId === activeTab ? "tab-button active" : "tab-button"}
              onClick={() => setActiveTab(tabId)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "overview" ? (
        <OverviewTab
          activeMission={activeMission}
          activeRun={activeRun}
          latestRelease={releaseEntries[0] ?? null}
          locale={locale}
          missionAgents={missionAgents}
          missionRuns={missionRuns}
          ui={ui}
        />
      ) : null}

      {activeTab === "runs" ? (
        <RunsTab
          activeRun={activeRun}
          activeRunParent={activeRunParent}
          activeSteeringEvents={activeSteeringEvents}
          archivedSteeringEvents={archivedSteeringEvents}
          autopilotResult={autopilotResult}
          changedFiles={changedFiles}
          currentFollowups={currentFollowups}
          diffArtifact={diffArtifact}
          diffFilePatches={diffFilePatches}
          followupRuns={followupRuns}
          handleRetryRun={handleRetryRun}
          handleSelectRun={handleSelectRun}
          handleSteeringSubmit={handleSteeringSubmit}
          handleTerminalStop={handleTerminalStop}
          latestSteeringRequest={latestSteeringRequest}
          locale={locale}
          primaryDecision={primaryDecision}
          rootRuns={rootRuns}
          runSurface={runSurface}
          selectedPatch={selectedPatch}
          setRunSurface={setRunSurface}
          setSelectedPatchPath={setSelectedPatchPath}
          steeringInput={steeringInput}
          ui={ui}
          onSteeringInputChange={setSteeringInput}
        />
      ) : null}

      {activeTab === "releases" ? (
        <ReleasesTab
          activeRun={activeRun}
          activeApprovalPackets={activeApprovalPackets}
          handleApproveRelease={handleApproveRelease}
          handleGenerateRelease={handleGenerateRelease}
          handleHandoffRelease={handleHandoffRelease}
          locale={locale}
          latestApprovalPacket={latestApprovalPacket}
          onOpenReleaseModal={() => setIsReleaseModalOpen(true)}
          releaseEntries={releaseEntries}
          selectedReleaseEntry={selectedReleaseEntry}
          onSelectRelease={(entry) => handleSelectRelease(entry, { openModal: true })}
          ui={ui}
        />
      ) : null}

      {activeTab === "notes" ? (
        <NotesTab
          activeRun={activeRun}
          lifecycleEvents={lifecycleEvents}
          locale={locale}
          ui={ui}
        />
      ) : null}
    </>
  );

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div className="header-brand">
          <p className="eyebrow">{ui.header.label}</p>
          <h1>UCM Desktop</h1>
          <p className="header-copy">
            {activeWorkspace?.name ?? ui.empty.workspace}
          </p>
        </div>
        <div className="header-focus workspace-focus" ref={workspaceMenuRef}>
          <span>{ui.header.workspace}</span>
          <button
            aria-expanded={isWorkspaceMenuOpen}
            className={`workspace-switcher${isWorkspaceMenuOpen ? " open" : ""}`}
            onClick={() => setIsWorkspaceMenuOpen((current) => !current)}
            type="button"
          >
            <div className="workspace-switcher-copy">
              <strong>{activeWorkspace?.name ?? "..."}</strong>
              <p>{activeWorkspace?.rootPath ?? ui.empty.workspace}</p>
            </div>
            <span className="workspace-switcher-caret" aria-hidden="true">
              {isWorkspaceMenuOpen ? "▴" : "▾"}
            </span>
          </button>
          {isWorkspaceMenuOpen ? (
            <div className="workspace-dropdown" role="menu">
              <div className="workspace-dropdown-list">
                {workspaces.map((workspace) => (
                  <button
                    className={`workspace-menu-item${workspace.active ? " active" : ""}`}
                    key={workspace.id}
                    onClick={() => {
                      void handleSelectWorkspace(workspace.id);
                    }}
                    type="button"
                  >
                    <div className="workspace-button-copy">
                      <strong>{workspace.name}</strong>
                      <p>{workspace.rootPath}</p>
                    </div>
                    <StatusPill tone={workspace.active ? "running" : "queued"}>
                      {workspace.active ? ui.rail.active : ui.rail.available}
                    </StatusPill>
                  </button>
                ))}
                {workspaces.length === 0 ? (
                  <div className="empty-copy">{ui.empty.workspace}</div>
                ) : null}
              </div>
              <button
                className="secondary-button compact"
                onClick={() => {
                  setWorkspaceBrowser(null);
                  setWorkspaceBrowserPathDraft("");
                  setWorkspaceBrowserError("");
                  setWorkspaceDirectoryName("");
                  setWorkspacePathDraft("");
                  setWorkspacePathError("");
                  setIsWorkspaceMenuOpen(false);
                  setIsWorkspaceAddModalOpen(true);
                }}
                type="button"
              >
                {ui.rail.addWorkspace}
              </button>
            </div>
          ) : null}
          <p>{selectedMissionTitle}</p>
          <div className="header-actions">
            <button
              className="primary-button compact"
              onClick={() => setIsComposerOpen(true)}
              type="button"
            >
              {locale === "ko" ? "새 미션" : "New Mission"}
            </button>
            <button
              className="secondary-button compact"
              onClick={() => setIsContextOpen(true)}
              type="button"
            >
              {locale === "ko" ? "세부 정보" : "Details"}
            </button>
          </div>
        </div>
        <div className="header-metrics">
          <MetricTile
            label={ui.header.providers}
            tone="review"
            value={
              (snapshot?.providerWindows ?? [])
                .map((windowInfo) => `${windowInfo.provider}:${windowInfo.status}`)
                .join(" • ") || "..."
            }
          />
          <MetricTile
            label={ui.header.agents}
            tone="running"
            value={String(snapshot?.activeAgents ?? 0)}
          />
          <MetricTile
            label={ui.header.blocked}
            tone="blocked"
            value={String(snapshot?.blockedAgents ?? 0)}
          />
          <MetricTile
            label={ui.header.review}
            tone="queued"
            value={String(snapshot?.reviewCount ?? 0)}
          />
        </div>
      </header>

      <div className="shell-body">
        <aside className="left-rail">
          <section className="panel-card rail-card">
            <PanelHeading eyebrow={ui.rail.inbox} title={ui.rail.inbox} />
            <div className="compact-section">
              <SectionMiniTitle title={ui.rail.blockedMissions} />
              <div className="mini-list">
                {blockedMissions.length > 0 ? (
                  blockedMissions.slice(0, 3).map((mission) => (
                    <button
                      className="inbox-item"
                      key={mission.id}
                      onClick={() => {
                        void handleOpenMission(mission.id, "runs");
                      }}
                      type="button"
                    >
                      <strong>{mission.title}</strong>
                      <p>{mission.latestResult ?? mission.goal ?? mission.title}</p>
                    </button>
                  ))
                ) : (
                  <div className="empty-copy">{ui.rail.noBlockedMissions}</div>
                )}
              </div>
            </div>
            <div className="compact-section">
              <SectionMiniTitle title={ui.rail.reviewQueue} />
              <div className="mini-list">
                {reviewQueue.length > 0 ? (
                  reviewQueue.slice(0, 3).map((entry) => (
                    <button
                      className="inbox-item"
                      key={entry.key}
                      onClick={() => {
                        void handleSelectRelease(entry, { openModal: true });
                      }}
                      type="button"
                    >
                      <strong>{entry.release.title}</strong>
                      <p>{entry.latestRevision?.summary ?? entry.run.summary}</p>
                    </button>
                  ))
                ) : (
                  <div className="empty-copy">{ui.rail.noReviewQueue}</div>
                )}
              </div>
            </div>
            <div className="compact-section">
              <SectionMiniTitle title={ui.rail.recentHandoffs} />
              <div className="mini-list">
                {recentHandoffs.length > 0 ? (
                  recentHandoffs.map((handoff) => (
                    <div className="inbox-item static" key={handoff.id}>
                      <strong>{handoff.channel}</strong>
                      <p>
                        {handoff.releaseRevisionId}
                        {handoff.target ? ` -> ${handoff.target}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="empty-copy">{ui.rail.noRecentHandoffs}</div>
                )}
              </div>
            </div>
          </section>

          <section className="panel-card rail-card">
            <PanelHeading eyebrow={ui.rail.missions} title={ui.rail.missions} />
            <div className="mission-list">
              {missions.map((mission) => (
                <button
                  className={`mission-button${mission.id === activeMission?.id ? " active" : ""}`}
                  key={mission.id}
                  onClick={() => {
                    void handleOpenMission(mission.id, mission.lineStatus ? "runs" : "overview");
                  }}
                  type="button"
                >
                  <div className="mission-button-head">
                    <strong>{mission.title}</strong>
                    <StatusPill tone={getStatusTone(mission.lineStatus ?? mission.status)}>
                      {formatStatusLabel(mission.lineStatus ?? mission.status, locale)}
                    </StatusPill>
                  </div>
                  <p>{mission.goal ?? mission.title}</p>
                  <div className="mission-meta">
                    <span>
                      {mission.artifactCount ?? 0} {locale === "ko" ? "artifacts" : "artifacts"}
                    </span>
                    {mission.attentionRequired ? (
                      <span>{locale === "ko" ? "확인 필요" : "Needs attention"}</span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          </section>

        </aside>

        <main className="main-canvas">{mainContent}</main>
      </div>

      <ComposerModal
        activeWorkspace={activeWorkspace}
        applyMissionTemplate={applyMissionTemplate}
        command={command}
        goal={goal}
        handleCreateMission={handleCreateMission}
        isOpen={isComposerOpen}
        locale={locale}
        missionTemplates={missionTemplates}
        onClose={() => setIsComposerOpen(false)}
        setCommand={setCommand}
        setGoal={setGoal}
        setTitle={setTitle}
        title={title}
        ui={ui}
      />

      <WorkspaceAddModal
        browser={workspaceBrowser}
        browserError={workspaceBrowserError}
        browserPathDraft={workspaceBrowserPathDraft}
        error={workspacePathError}
        handleAddWorkspace={handleAddWorkspace}
        handleBrowseWorkspacePath={handleBrowseWorkspacePath}
        handleCreateWorkspaceDirectory={handleCreateWorkspaceDirectory}
        isBusy={isWorkspaceBrowserBusy}
        isOpen={isWorkspaceAddModalOpen}
        locale={locale}
        onClose={() => {
          setWorkspaceBrowser(null);
          setWorkspaceBrowserError("");
          setWorkspaceBrowserPathDraft("");
          setWorkspaceDirectoryName("");
          setWorkspacePathError("");
          setIsWorkspaceAddModalOpen(false);
        }}
        setWorkspaceBrowserPathDraft={setWorkspaceBrowserPathDraft}
        setWorkspaceDirectoryName={setWorkspaceDirectoryName}
        setWorkspacePathDraft={setWorkspacePathDraft}
        ui={ui}
        workspaceDirectoryName={workspaceDirectoryName}
        workspacePathDraft={workspacePathDraft}
      />

      <ContextModal
        attentionItems={attentionItems}
        autopilotResult={autopilotResult}
        isOpen={isContextOpen}
        locale={locale}
        missionAgents={missionAgents}
        onClose={() => setIsContextOpen(false)}
        primaryDecision={primaryDecision}
        setLocale={setLocale}
        snapshot={snapshot}
        ui={ui}
        version={version}
      />

      <ReleaseDetailModal
        activeApprovalPackets={activeApprovalPackets}
        activeRun={activeRun}
        handleApproveRelease={handleApproveRelease}
        handleGenerateRelease={handleGenerateRelease}
        handleHandoffRelease={handleHandoffRelease}
        isOpen={isReleaseModalOpen}
        latestApprovalPacket={latestApprovalPacket}
        locale={locale}
        onClose={() => setIsReleaseModalOpen(false)}
        selectedReleaseEntry={selectedReleaseEntry}
        ui={ui}
      />
    </div>
  );
}

function ModalShell({
  children,
  eyebrow,
  isOpen,
  locale,
  onClose,
  title,
  wide = false,
}: {
  children: React.ReactNode;
  eyebrow: string;
  isOpen: boolean;
  locale: Locale;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-modal="true"
        className={`modal-shell${wide ? " wide" : ""}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button
            aria-label={locale === "ko" ? "닫기" : "Close"}
            className="modal-close-button"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function ComposerModal({
  activeWorkspace,
  applyMissionTemplate,
  command,
  goal,
  handleCreateMission,
  isOpen,
  locale,
  missionTemplates,
  onClose,
  setCommand,
  setGoal,
  setTitle,
  title,
  ui,
}: {
  activeWorkspace: WorkspaceSummary | null;
  applyMissionTemplate: (templateId: (typeof missionTemplates)["ko"][number]["id"]) => void;
  command: string;
  goal: string;
  handleCreateMission: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  isOpen: boolean;
  locale: Locale;
  missionTemplates: typeof missionTemplates;
  onClose: () => void;
  setCommand: (value: string) => void;
  setGoal: (value: string) => void;
  setTitle: (value: string) => void;
  title: string;
  ui: UiCopy;
}) {
  return (
    <ModalShell
      eyebrow={ui.rail.composer}
      isOpen={isOpen}
      locale={locale}
      onClose={onClose}
      title={ui.composer.title}
    >
      <div className="modal-stack">
        <p className="panel-copy">{ui.composer.subtitle}</p>
        <div className="template-row">
          {missionTemplates[locale].map((template) => (
            <button
              className="chip-button"
              key={template.id}
              onClick={() => applyMissionTemplate(template.id)}
              type="button"
            >
              {template.label}
            </button>
          ))}
        </div>
        <form className="composer-form" onSubmit={handleCreateMission}>
          <label className="field">
            <span>{ui.composer.missionTitle}</span>
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder={ui.composer.titlePlaceholder}
              value={title}
            />
          </label>
          <label className="field">
            <span>{ui.composer.goal}</span>
            <textarea
              onChange={(event) => setGoal(event.target.value)}
              placeholder={ui.composer.goalPlaceholder}
              rows={4}
              value={goal}
            />
          </label>
          <label className="field">
            <span>{ui.composer.command}</span>
            <input
              onChange={(event) => setCommand(event.target.value)}
              placeholder={ui.composer.commandPlaceholder}
              value={command}
            />
          </label>
          <div className="launch-mode-card">
            <strong>{ui.composer.launchMode}</strong>
            <p>
              {command.trim()
                ? `${ui.composer.commandMode} ${command.trim()}`
                : ui.composer.planMode}
            </p>
            {activeWorkspace ? (
              <small>{activeWorkspace.name}</small>
            ) : (
              <small>{ui.empty.workspace}</small>
            )}
          </div>
          <button
            className="primary-button"
            disabled={!activeWorkspace || !title.trim() || !goal.trim()}
            type="submit"
          >
            {ui.composer.createMission}
          </button>
        </form>
      </div>
    </ModalShell>
  );
}

function WorkspaceAddModal({
  browser,
  browserError,
  browserPathDraft,
  error,
  handleAddWorkspace,
  handleBrowseWorkspacePath,
  handleCreateWorkspaceDirectory,
  isBusy,
  isOpen,
  locale,
  onClose,
  setWorkspaceBrowserPathDraft,
  setWorkspaceDirectoryName,
  setWorkspacePathDraft,
  ui,
  workspaceDirectoryName,
  workspacePathDraft,
}: {
  browser: WorkspaceBrowserSnapshot | null;
  browserError: string;
  browserPathDraft: string;
  error: string;
  handleAddWorkspace: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleBrowseWorkspacePath: (
    rootPath?: string,
    options?: { selectCurrentPath?: boolean },
  ) => Promise<void>;
  handleCreateWorkspaceDirectory: (
    event: React.FormEvent<HTMLFormElement>,
  ) => Promise<void>;
  isBusy: boolean;
  isOpen: boolean;
  locale: Locale;
  onClose: () => void;
  setWorkspaceBrowserPathDraft: (value: string) => void;
  setWorkspaceDirectoryName: (value: string) => void;
  setWorkspacePathDraft: (value: string) => void;
  ui: UiCopy;
  workspaceDirectoryName: string;
  workspacePathDraft: string;
}) {
  const browserTitle = locale === "ko" ? "폴더 브라우저" : "Folder Browser";
  const browserHelp =
    locale === "ko"
      ? "네이티브 파일 선택기 없이 폴더를 탐색하고 현재 위치를 바로 워크스페이스로 추가합니다."
      : "Browse directories and add the current location as a workspace without a native picker.";
  const pathInputLabel = locale === "ko" ? "브라우저 위치" : "Browser location";
  const selectedPathLabel = locale === "ko" ? "선택된 폴더" : "Selected folder";
  const directoryNameLabel = locale === "ko" ? "새 폴더 이름" : "New folder name";

  return (
    <ModalShell
      eyebrow={ui.rail.workspaces}
      isOpen={isOpen}
      locale={locale}
      onClose={onClose}
      title={locale === "ko" ? "워크스페이스 추가" : "Add Workspace"}
    >
      <div className="modal-stack workspace-add-modal">
        <p className="panel-copy">{browserHelp}</p>

        <section className="workspace-browser-card">
          <div className="workspace-browser-toolbar">
            <div className="workspace-browser-actions">
              <button
                className="secondary-button compact"
                onClick={() => {
                  void handleBrowseWorkspacePath(browser?.homePath, {
                    selectCurrentPath: true,
                  });
                }}
                type="button"
              >
                {locale === "ko" ? "홈" : "Home"}
              </button>
              <button
                className="secondary-button compact"
                disabled={!browser?.parentPath}
                onClick={() => {
                  void handleBrowseWorkspacePath(browser?.parentPath ?? undefined, {
                    selectCurrentPath: true,
                  });
                }}
                type="button"
              >
                {locale === "ko" ? "상위 폴더" : "Up"}
              </button>
            </div>
            <label className="field workspace-browser-path-field">
              <span>{pathInputLabel}</span>
              <div className="workspace-browser-path-row">
                <input
                  onChange={(event) => {
                    setWorkspaceBrowserPathDraft(event.target.value);
                    setWorkspaceBrowserError("");
                  }}
                  placeholder={browser?.homePath ?? "/"}
                  value={browserPathDraft}
                />
                <button
                  className="secondary-button compact"
                  onClick={() => {
                    void handleBrowseWorkspacePath(browserPathDraft, {
                      selectCurrentPath: true,
                    });
                  }}
                  type="button"
                >
                  {locale === "ko" ? "이동" : "Go"}
                </button>
              </div>
            </label>
          </div>

          <div className="workspace-browser-header">
            <div>
              <p className="eyebrow">{browserTitle}</p>
              <strong>{browser?.currentPath ?? (locale === "ko" ? "불러오는 중" : "Loading")}</strong>
            </div>
            <button
              className="primary-button compact"
              disabled={!browser}
              onClick={() => {
                if (!browser) {
                  return;
                }
                setWorkspacePathDraft(browser.currentPath);
                setWorkspacePathError("");
              }}
              type="button"
            >
              {locale === "ko" ? "현재 폴더 선택" : "Use Current Folder"}
            </button>
          </div>

          <div className="workspace-browser-list" role="list">
            {isBusy ? (
              <div className="empty-copy">
                {locale === "ko" ? "폴더를 불러오는 중입니다." : "Loading folders."}
              </div>
            ) : browser && browser.directories.length > 0 ? (
              browser.directories.map((directory) => (
                <button
                  className="workspace-browser-item"
                  key={directory.path}
                  onClick={() => {
                    void handleBrowseWorkspacePath(directory.path, {
                      selectCurrentPath: true,
                    });
                  }}
                  type="button"
                >
                  <div className="workspace-browser-item-copy">
                    <strong>{directory.name}</strong>
                    <p>{directory.path}</p>
                  </div>
                  {directory.isRepositoryRoot ? (
                    <StatusPill tone="review">
                      {locale === "ko" ? "저장소" : "Repo"}
                    </StatusPill>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="empty-copy">
                {locale === "ko"
                  ? "이 위치에는 탐색할 하위 폴더가 없습니다."
                  : "No child directories are available here."}
              </div>
            )}
          </div>

          <form className="workspace-browser-create-form" onSubmit={handleCreateWorkspaceDirectory}>
            <label className="field">
              <span>{directoryNameLabel}</span>
              <div className="workspace-browser-path-row">
                <input
                  onChange={(event) => {
                    setWorkspaceDirectoryName(event.target.value);
                    setWorkspaceBrowserError("");
                  }}
                  placeholder={locale === "ko" ? "예: storefront-next" : "Example: storefront-next"}
                  value={workspaceDirectoryName}
                />
                <button
                  className="secondary-button compact"
                  disabled={!browser || !workspaceDirectoryName.trim()}
                  type="submit"
                >
                  {locale === "ko" ? "새 폴더 만들기" : "Create Folder"}
                </button>
              </div>
            </label>
          </form>

          {browserError ? <p className="form-error">{browserError}</p> : null}
        </section>

        <form className="composer-form compact" onSubmit={handleAddWorkspace}>
          <label className="field">
            <span>{selectedPathLabel}</span>
            <input
              onChange={(event) => {
                setWorkspacePathDraft(event.target.value);
                setWorkspacePathError("");
              }}
              placeholder={browser?.currentPath ?? "/home/siddhik/git/example"}
              value={workspacePathDraft}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="button-row">
            <button className="secondary-button" onClick={onClose} type="button">
              {locale === "ko" ? "취소" : "Cancel"}
            </button>
            <button className="primary-button" type="submit">
              {ui.rail.addWorkspace}
            </button>
          </div>
        </form>
      </div>
    </ModalShell>
  );
}

function ContextModal({
  attentionItems,
  autopilotResult,
  isOpen,
  locale,
  missionAgents,
  onClose,
  primaryDecision,
  setLocale,
  snapshot,
  ui,
  version,
}: {
  attentionItems: AgentLifecycleEvent[];
  autopilotResult: RunAutopilotResult;
  isOpen: boolean;
  locale: Locale;
  missionAgents: AgentSnapshot[];
  onClose: () => void;
  primaryDecision: DecisionRecord | null;
  setLocale: (locale: Locale) => void;
  snapshot: ShellSnapshot | null;
  ui: UiCopy;
  version: string;
}) {
  return (
    <ModalShell
      eyebrow={ui.settings.label}
      isOpen={isOpen}
      locale={locale}
      onClose={onClose}
      title={locale === "ko" ? "현재 컨텍스트" : "Current Context"}
      wide
    >
      <div className="modal-grid">
        <section className="content-card context-section">
          <PanelHeading eyebrow={ui.runs.providerWindows} title={ui.runs.providerWindows} />
          <div className="provider-grid">
            {(snapshot?.providerWindows ?? []).map((windowInfo) => (
              <div className="provider-card" key={windowInfo.provider}>
                <div className="provider-card-head">
                  <strong>{windowInfo.provider}</strong>
                  <StatusPill tone={getStatusTone(windowInfo.status)}>
                    {formatStatusLabel(windowInfo.status, locale)}
                  </StatusPill>
                </div>
                <p>
                  {windowInfo.activeRuns} {locale === "ko" ? "active" : "active"} •{" "}
                  {windowInfo.queuedRuns} {locale === "ko" ? "queued" : "queued"}
                </p>
                <small>{windowInfo.nextAvailableLabel}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="content-card context-section">
          <PanelHeading eyebrow={ui.mission.agents} title={ui.mission.agents} />
          <div className="context-list">
            {missionAgents.slice(0, 6).map((agent) => (
              <div className="context-item" key={agent.id}>
                <div>
                  <strong>{agent.name}</strong>
                  <p>{agent.objective}</p>
                </div>
                <StatusPill tone={getStatusTone(agent.status)}>
                  {formatStatusLabel(agent.status, locale)}
                </StatusPill>
              </div>
            ))}
            {missionAgents.length === 0 ? (
              <div className="empty-copy">{ui.empty.mission}</div>
            ) : null}
          </div>
        </section>

        <section className="content-card context-section">
          <PanelHeading eyebrow={ui.runs.autopilot} title={ui.runs.autopilot} />
          <div className="focus-card">
            <StatusPill tone={getDecisionTone(autopilotResult.decision)}>
              {autopilotResult.decision}
            </StatusPill>
            <p>{autopilotResult.summary}</p>
            <small>
              {ui.runs.lastEvent}: {autopilotResult.eventKind}
            </small>
          </div>
          {primaryDecision ? (
            <DecisionCard decision={primaryDecision} locale={locale} />
          ) : null}
        </section>

        <section className="content-card context-section">
          <PanelHeading eyebrow={ui.notes.timeline} title={ui.notes.timeline} />
          <div className="context-list">
            {attentionItems.slice(0, 6).map((event) => (
              <div className="context-item" key={event.id}>
                <div>
                  <strong>{event.summary}</strong>
                  <p>{event.createdAtLabel}</p>
                </div>
                <StatusPill tone={getLifecycleTone(event.kind)}>
                  {formatLifecycleKind(event.kind, locale)}
                </StatusPill>
              </div>
            ))}
            {attentionItems.length === 0 ? (
              <div className="empty-copy">{ui.mission.noLifecycle}</div>
            ) : null}
          </div>
        </section>

        <section className="content-card context-section span-two">
          <PanelHeading eyebrow={ui.settings.label} title={ui.settings.label} />
          <p className="panel-copy">{ui.settings.guidance}</p>
          <div className="button-row">
            <button
              className={locale === "ko" ? "primary-button compact" : "secondary-button compact"}
              onClick={() => setLocale("ko")}
              type="button"
            >
              {ui.settings.korean}
            </button>
            <button
              className={locale === "en" ? "primary-button compact" : "secondary-button compact"}
              onClick={() => setLocale("en")}
              type="button"
            >
              {ui.settings.english}
            </button>
          </div>
          <small className="build-tag">v{version}</small>
        </section>
      </div>
    </ModalShell>
  );
}

function ReleaseDetailModal({
  activeApprovalPackets,
  activeRun,
  handleApproveRelease,
  handleGenerateRelease,
  handleHandoffRelease,
  isOpen,
  latestApprovalPacket,
  locale,
  onClose,
  selectedReleaseEntry,
  ui,
}: {
  activeApprovalPackets: ReleaseRevision[];
  activeRun: RunDetail | null;
  handleApproveRelease: (revisionId: string) => Promise<void>;
  handleGenerateRelease: () => Promise<void>;
  handleHandoffRelease: (channel: HandoffRecord["channel"]) => Promise<void>;
  isOpen: boolean;
  latestApprovalPacket: ReleaseRevision | null;
  locale: Locale;
  onClose: () => void;
  selectedReleaseEntry: ReleaseEntry | null;
  ui: UiCopy;
}) {
  return (
    <ModalShell
      eyebrow={ui.releases.label}
      isOpen={isOpen}
      locale={locale}
      onClose={onClose}
      title={selectedReleaseEntry?.release.title ?? ui.releases.label}
      wide
    >
      {selectedReleaseEntry ? (
        <div className="modal-grid">
          <section className="content-card context-section">
            <div className="release-hero">
              <div>
                <p className="eyebrow">{selectedReleaseEntry.run.title}</p>
                <h3>{selectedReleaseEntry.latestRevision?.summary ?? ui.releases.noRevision}</h3>
              </div>
              <StatusPill tone={getStatusTone(selectedReleaseEntry.run.status)}>
                {selectedReleaseEntry.latestRevision
                  ? `v${selectedReleaseEntry.latestRevision.revision}`
                  : formatStatusLabel(selectedReleaseEntry.run.status, locale)}
              </StatusPill>
            </div>

            <SectionMiniTitle title={ui.releases.latestVersion} />
            <div className="focus-card">
              <strong>{selectedReleaseEntry.latestRevision?.id ?? ui.releases.noRevision}</strong>
              <p>{selectedReleaseEntry.latestRevision?.summary ?? ui.releases.noRevision}</p>
              <small>
                {selectedReleaseEntry.latestRevision?.createdAtLabel ?? ui.releases.noRevision}
              </small>
            </div>

            <SectionMiniTitle title={ui.releases.evidence} />
            <div className="mini-list">
              {selectedReleaseEntry.run.artifacts.length > 0 ? (
                selectedReleaseEntry.run.artifacts.map((artifact) => (
                  <div className="static-card" key={artifact.id}>
                    <strong>{artifact.title}</strong>
                    <p>{artifact.preview}</p>
                  </div>
                ))
              ) : (
                <div className="empty-copy">{ui.releases.noEvidence}</div>
              )}
            </div>
          </section>

          <section className="content-card context-section">
            <SectionMiniTitle title={ui.releases.approval} />
            <div className="focus-card">
              <strong>
                {latestApprovalPacket?.summary ??
                  (locale === "ko"
                    ? "승인할 항목이 없습니다."
                    : "No approval item is active.")}
              </strong>
              <p>
                {activeApprovalPackets.length > 0
                  ? locale === "ko"
                    ? `${activeApprovalPackets.length}개 버전이 진행 중입니다.`
                    : `${activeApprovalPackets.length} versions are active.`
                  : ui.releases.noRevision}
              </p>
            </div>

            <SectionMiniTitle title={ui.releases.handoff} />
            <div className="mini-list">
              {selectedReleaseEntry.handoffs.length > 0 ? (
                selectedReleaseEntry.handoffs.map((handoff) => (
                  <div className="static-card" key={handoff.id}>
                    <strong>{handoff.channel}</strong>
                    <p>
                      {handoff.releaseRevisionId}
                      {handoff.target ? ` -> ${handoff.target}` : ""}
                    </p>
                  </div>
                ))
              ) : (
                <div className="empty-copy">{ui.releases.noHandoff}</div>
              )}
            </div>

            <SectionMiniTitle title={ui.releases.approval} />
            <div className="action-stack">
              <div className="action-card">
                <strong>{ui.releases.generate}</strong>
                <p>{ui.releases.generated}</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    void handleGenerateRelease();
                  }}
                  type="button"
                >
                  {ui.releases.generate}
                </button>
              </div>

              <div className="action-card">
                <strong>{ui.releases.handoff}</strong>
                <p>{ui.releases.sendHelp}</p>
                <div className="button-row">
                  <button
                    className="secondary-button"
                    disabled={!selectedReleaseEntry.latestRevision}
                    onClick={() => {
                      void handleHandoffRelease("inbox");
                    }}
                    type="button"
                  >
                    {ui.releases.sendInbox}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={!selectedReleaseEntry.latestRevision}
                    onClick={() => {
                      void handleHandoffRelease("export");
                    }}
                    type="button"
                  >
                    {ui.releases.export}
                  </button>
                </div>
              </div>

              <div className="action-card">
                <strong>{ui.releases.approval}</strong>
                <p>{ui.releases.approveHelp}</p>
                <button
                  className="primary-button"
                  disabled={!activeRun || !latestApprovalPacket || latestApprovalPacket.status !== "active"}
                  onClick={() => {
                    if (latestApprovalPacket) {
                      void handleApproveRelease(latestApprovalPacket.id);
                    }
                  }}
                  type="button"
                >
                  {ui.releases.approveLatest}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="empty-copy">{ui.releases.noRelease}</div>
      )}
    </ModalShell>
  );
}

function EmptyMissionState({
  activeWorkspace,
  locale,
  ui,
}: {
  activeWorkspace: WorkspaceSummary | null;
  locale: Locale;
  ui: UiCopy;
}) {
  return (
    <section className="empty-state-card">
      <p className="eyebrow">{ui.header.mission}</p>
      <h2>{ui.empty.mission}</h2>
      <p>
        {activeWorkspace
          ? locale === "ko"
            ? `${activeWorkspace.name} 워크스페이스에서 첫 미션을 생성하면 이 캔버스가 미션 중심으로 전환됩니다.`
            : `Create the first mission in ${activeWorkspace.name} and this canvas will switch into the mission workspace.`
          : ui.empty.workspace}
      </p>
    </section>
  );
}

function OverviewTab({
  activeMission,
  activeRun,
  latestRelease,
  locale,
  missionAgents,
  missionRuns,
  ui,
}: {
  activeMission: MissionDetail;
  activeRun: RunDetail | null;
  latestRelease: ReleaseEntry | null;
  locale: Locale;
  missionAgents: AgentSnapshot[];
  missionRuns: RunDetail[];
  ui: UiCopy;
}) {
  return (
    <section className="tab-layout overview-layout">
      <div className="content-card">
        <PanelHeading eyebrow={ui.mission.goal} title={ui.mission.goal} />
        <h3>{activeMission.goal || ui.mission.noGoal}</h3>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.mission.successCriteria} title={ui.mission.successCriteria} />
        <ul className="bullet-list">
          {(activeMission.successCriteria ?? []).length > 0 ? (
            activeMission.successCriteria.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>{ui.mission.noCriteria}</li>
          )}
        </ul>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.mission.constraints} title={ui.mission.constraints} />
        <ul className="bullet-list">
          {(activeMission.constraints ?? []).length > 0 ? (
            activeMission.constraints.map((item) => <li key={item}>{item}</li>)
          ) : (
            <li>{ui.mission.noConstraints}</li>
          )}
        </ul>
      </div>

      <div className="content-card span-two">
        <PanelHeading eyebrow={ui.mission.phases} title={ui.mission.phases} />
        <div className="phase-list">
          {(activeMission.phases ?? []).length > 0 ? (
            activeMission.phases.map((phase) => (
              <div className="phase-card" key={phase.id}>
                <div className="phase-card-head">
                  <strong>{phase.title}</strong>
                  <StatusPill tone={getPhaseTone(phase.status)}>
                    {formatPhaseStatus(phase.status, locale)}
                  </StatusPill>
                </div>
                <p>{phase.objective}</p>
              </div>
            ))
          ) : (
            <div className="empty-copy">{ui.mission.noPhases}</div>
          )}
        </div>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.mission.agents} title={ui.mission.agents} />
        <div className="compact-list">
          {missionAgents.length > 0 ? (
            missionAgents.map((agent) => (
              <div className="compact-card" key={agent.id}>
                <div>
                  <strong>{agent.name}</strong>
                  <p>{agent.objective}</p>
                </div>
                <StatusPill tone={getStatusTone(agent.status)}>
                  {formatStatusLabel(agent.status, locale)}
                </StatusPill>
              </div>
            ))
          ) : (
            <div className="empty-copy">{ui.empty.runs}</div>
          )}
        </div>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.mission.latestRun} title={ui.mission.latestRun} />
        <div className="focus-card">
          <strong>{activeRun?.title ?? ui.empty.runs}</strong>
          <StatusPill tone={getStatusTone(activeRun?.status ?? "queued")}>
            {formatStatusLabel(activeRun?.status ?? "queued", locale)}
          </StatusPill>
          <p>{activeRun?.summary ?? ui.mission.noDetail}</p>
          <small>
            {missionRuns.length} {locale === "ko" ? "개의 실행이 이 미션에 연결돼 있습니다." : "runs are connected to this mission."}
          </small>
        </div>
      </div>

      <div className="content-card span-two">
        <PanelHeading eyebrow={ui.mission.latestRelease} title={ui.mission.latestRelease} />
        <div className="focus-card">
          <strong>{latestRelease?.release.title ?? ui.releases.noRelease}</strong>
          <StatusPill tone={getStatusTone(latestRelease?.run.status ?? "queued")}>
            {formatStatusLabel(latestRelease?.run.status ?? "queued", locale)}
          </StatusPill>
          <p>{latestRelease?.latestRevision?.summary ?? ui.releases.noRevision}</p>
          <small>
            {latestRelease?.run.title ??
              (locale === "ko"
                ? "아직 릴리즈가 생성되지 않았습니다."
                : "No release has been generated yet.")}
          </small>
        </div>
      </div>
    </section>
  );
}

function RunsTab({
  activeRun,
  activeRunParent,
  activeSteeringEvents,
  archivedSteeringEvents,
  autopilotResult,
  changedFiles,
  currentFollowups,
  diffArtifact,
  diffFilePatches,
  followupRuns,
  handleRetryRun,
  handleSelectRun,
  handleSteeringSubmit,
  handleTerminalStop,
  latestSteeringRequest,
  locale,
  primaryDecision,
  rootRuns,
  runSurface,
  selectedPatch,
  setRunSurface,
  setSelectedPatchPath,
  steeringInput,
  ui,
  onSteeringInputChange,
}: {
  activeRun: RunDetail | null;
  activeRunParent: RunDetail | null;
  activeSteeringEvents: RunDetail["runEvents"];
  archivedSteeringEvents: RunDetail["runEvents"];
  autopilotResult: RunAutopilotResult;
  changedFiles: string[];
  currentFollowups: RunDetail[];
  diffArtifact: ArtifactRecord | null;
  diffFilePatches: FilePatch[];
  followupRuns: RunDetail[];
  handleRetryRun: (runId: string) => Promise<void>;
  handleSelectRun: (runId: string) => Promise<void>;
  handleSteeringSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  handleTerminalStop: () => Promise<void>;
  latestSteeringRequest: RunDetail["runEvents"][number] | null;
  locale: Locale;
  primaryDecision: DecisionRecord | null;
  rootRuns: RunDetail[];
  runSurface: RunSurface;
  selectedPatch: FilePatch | null;
  setRunSurface: (surface: RunSurface) => void;
  setSelectedPatchPath: (path: string) => void;
  steeringInput: string;
  ui: UiCopy;
  onSteeringInputChange: (value: string) => void;
}) {
  const recentEvents = activeRun?.runEvents ?? [];
  const recentArtifacts = activeRun?.artifacts ?? [];

  return (
    <section className="tab-layout runs-layout">
      <div className="content-card run-stream-card">
        <PanelHeading eyebrow={ui.runs.label} title={ui.runs.label} />
        <SectionMiniTitle title={ui.runs.rootRuns} />
        <div className="mini-list">
          {rootRuns.map((run) => (
            <button
              className={`run-list-item${activeRun?.id === run.id ? " active" : ""}`}
              key={run.id}
              onClick={() => {
                void handleSelectRun(run.id);
              }}
              type="button"
            >
              <div>
                <strong>{run.title}</strong>
                <p>{run.summary}</p>
              </div>
              <StatusPill tone={getStatusTone(run.status)}>
                {formatStatusLabel(run.status, locale)}
              </StatusPill>
            </button>
          ))}
          {rootRuns.length === 0 ? (
            <div className="empty-copy">{ui.empty.runs}</div>
          ) : null}
        </div>

        <SectionMiniTitle title={ui.runs.followups} />
        <div className="mini-list">
          {followupRuns.slice(0, 6).map((run) => (
            <button
              className={`run-list-item compact${activeRun?.id === run.id ? " active" : ""}`}
              key={run.id}
              onClick={() => {
                void handleSelectRun(run.id);
              }}
              type="button"
            >
              <div>
                <strong>{run.title}</strong>
                <p>{run.origin?.schedulerRuleId ?? run.summary}</p>
              </div>
              <StatusPill tone={getStatusTone(run.status)}>
                {formatStatusLabel(run.status, locale)}
              </StatusPill>
            </button>
          ))}
          {followupRuns.length === 0 ? (
            <div className="empty-copy">{ui.runs.noFollowups}</div>
          ) : null}
        </div>
      </div>

      <div className="content-card run-workbench-card">
        {!activeRun ? (
          <div className="empty-copy">{ui.runs.noRun}</div>
        ) : (
          <>
            <div className="workbench-summary">
              <MetricTile
                label={ui.runs.runStatus}
                tone={getStatusTone(activeRun.status)}
                value={formatStatusLabel(activeRun.status, locale)}
              />
              <MetricTile
                label={ui.runs.userAttention}
                tone={latestSteeringRequest ? "blocked" : "review"}
                value={
                  latestSteeringRequest
                    ? locale === "ko"
                      ? "확인 필요"
                      : "Attention"
                    : locale === "ko"
                      ? "정상"
                      : "Stable"
                }
              />
              <MetricTile
                label={ui.runs.outputs}
                tone="queued"
                value={String(activeRun.releases.length)}
              />
            </div>

            <div className="detail-headline">
              <div>
                <p className="eyebrow">{activeRun.title}</p>
                <h3>{activeRun.summary}</h3>
              </div>
              {activeRun.workspaceCommand ? (
                <button
                  className="secondary-button"
                  disabled={activeRun.status === "running"}
                  onClick={() => {
                    void handleRetryRun(activeRun.id);
                  }}
                  type="button"
                >
                  {ui.runs.retryRun}
                </button>
              ) : null}
            </div>

            <div className="subtab-strip" role="tablist" aria-label="run views">
              <button
                className={runSurface === "diff" ? "subtab-button active" : "subtab-button"}
                onClick={() => setRunSurface("diff")}
                type="button"
              >
                {ui.runs.patch}
              </button>
              <button
                className={runSurface === "trace" ? "subtab-button active" : "subtab-button"}
                onClick={() => setRunSurface("trace")}
                type="button"
              >
                {ui.runs.trace}
              </button>
            </div>

            {runSurface === "diff" ? (
              <div className="workbench-surface">
                <section className="surface-sidebar">
                  <SectionMiniTitle title={ui.runs.changedFiles} />
                  <div className="mini-list">
                    {changedFiles.length > 0 ? (
                      changedFiles.map((filePath) => (
                        <button
                          className={`patch-file-button${filePath === selectedPatch?.path ? " active" : ""}`}
                          key={filePath}
                          onClick={() => setSelectedPatchPath(filePath)}
                          type="button"
                        >
                          <strong>{filePath}</strong>
                          <p>
                            {diffFilePatches.find((patch) => patch.path === filePath)?.summary ??
                              ui.runs.patchSurface}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="empty-copy">{ui.runs.noChangedFiles}</div>
                    )}
                  </div>
                </section>
                <section className="surface-main">
                  <div className="surface-header">
                    <SectionMiniTitle title={ui.runs.patchSurface} />
                    <StatusPill tone={getStatusTone(activeRun.status)}>
                      {formatStatusLabel(activeRun.status, locale)}
                    </StatusPill>
                  </div>
                  <pre className="patch-surface" data-testid="patch-surface">
{selectedPatch?.patch ??
  (diffArtifact
    ? buildFallbackPatch(diffArtifact)
    : ui.runs.noDiffPreview)}
                  </pre>
                </section>
              </div>
            ) : (
              <div className="trace-grid">
                <div className="trace-column">
                  <SectionMiniTitle title={ui.runs.executionTrace} />
                  <div className="timeline-list">
                    {recentEvents.length > 0 ? (
                      recentEvents.map((event) => (
                        <div className="timeline-row" key={event.id}>
                          <strong>{event.summary}</strong>
                          <p>
                            {formatEventKind(event.kind, locale)}
                            {event.agentId ? ` • ${event.agentId}` : ""}
                            {` • ${event.createdAtLabel}`}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="empty-copy">{ui.runs.noTrace}</div>
                    )}
                  </div>
                </div>

                <div className="trace-column">
                  <SectionMiniTitle title={ui.runs.terminalTrace} />
                  <div className="terminal-box">
                    <strong>
                      {activeRun.terminalProvider
                        ? `${activeRun.terminalProvider} session`
                        : ui.runs.noTerminal}
                    </strong>
                    <pre>{(activeRun.terminalPreview ?? []).join("\n")}</pre>
                  </div>
                </div>

                <div className="trace-column">
                  <SectionMiniTitle title={ui.runs.artifactTrace} />
                  <div className="mini-list">
                    {recentArtifacts.length > 0 ? (
                      recentArtifacts.map((artifact) => (
                        <div className="static-card" key={artifact.id}>
                          <strong>{artifact.title}</strong>
                          <p>{artifact.preview}</p>
                        </div>
                      ))
                    ) : (
                      <div className="empty-copy">{ui.runs.noArtifacts}</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="content-card run-context-card">
        <PanelHeading eyebrow={ui.runs.missionPressure} title={ui.runs.missionPressure} />
        {!activeRun ? (
          <div className="empty-copy">{ui.runs.noRun}</div>
        ) : (
          <>
            <div className="focus-card">
              <strong>{ui.runs.autopilot}</strong>
              <StatusPill tone={getDecisionTone(autopilotResult.decision)}>
                {autopilotResult.decision}
              </StatusPill>
              <p>{autopilotResult.summary}</p>
            </div>

            <SectionMiniTitle title={ui.runs.runLineage} />
            <div className="mini-list">
              <div className="static-card">
                <strong>{ui.runs.parentRun}</strong>
                <p>{activeRunParent?.title ?? ui.runs.noParent}</p>
              </div>
              {currentFollowups.length > 0 ? (
                currentFollowups.map((run) => (
                  <button
                    className="inbox-item"
                    key={run.id}
                    onClick={() => {
                      void handleSelectRun(run.id);
                    }}
                    type="button"
                  >
                    <strong>{run.title}</strong>
                    <p>{run.origin?.schedulerRuleId ?? run.summary}</p>
                  </button>
                ))
              ) : (
                <div className="empty-copy">{ui.runs.noFollowups}</div>
              )}
            </div>

            <SectionMiniTitle title={ui.runs.steeringInbox} />
            <form className="composer-form compact" onSubmit={handleSteeringSubmit}>
              <label className="field">
                <span>{ui.runs.steeringInbox}</span>
                <input
                  onChange={(event) => onSteeringInputChange(event.target.value)}
                  placeholder={ui.runs.steeringPlaceholder}
                  value={steeringInput}
                />
              </label>
              <button
                className="primary-button"
                disabled={!activeRun.id || !steeringInput.trim()}
                type="submit"
              >
                {ui.runs.submitSteering}
              </button>
            </form>
            <div className="mini-list">
              {activeSteeringEvents.length > 0 ? (
                activeSteeringEvents.map((event) => (
                  <div className="static-card" key={event.id}>
                    <strong>{event.metadata?.steering ?? event.summary}</strong>
                    <p>{formatStatusLabel(event.metadata?.status ?? "active", locale)}</p>
                  </div>
                ))
              ) : (
                <div className="empty-copy">
                  {latestSteeringRequest?.summary ?? ui.runs.noSteering}
                </div>
              )}
              {archivedSteeringEvents.slice(0, 2).map((event) => (
                <div className="static-card" key={event.id}>
                  <strong>{event.metadata?.steering ?? event.summary}</strong>
                  <p>{formatStatusLabel(event.metadata?.status ?? "superseded", locale)}</p>
                </div>
              ))}
            </div>

            <SectionMiniTitle title={ui.runs.providerWindows} />
            <div className="static-card">
              <strong>{primaryDecision?.summary ?? activeRun.title}</strong>
              <p>
                {ui.runs.lastEvent}: {recentEvents.at(-1)?.kind ?? autopilotResult.eventKind}
              </p>
              <p>
                {ui.runs.budget}: {activeRun.budgetClass ?? "default"} •{" "}
                {activeRun.providerPreference ?? "n/a"}
              </p>
            </div>

            <button
              className="secondary-button danger"
              disabled={!activeRun.terminalSessionId}
              onClick={() => {
                void handleTerminalStop();
              }}
              type="button"
            >
              {ui.runs.stopSession}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function ReleasesTab({
  activeRun,
  activeApprovalPackets,
  locale,
  latestApprovalPacket,
  onOpenReleaseModal,
  releaseEntries,
  selectedReleaseEntry,
  onSelectRelease,
  ui,
}: {
  activeRun: RunDetail | null;
  activeApprovalPackets: ReleaseRevision[];
  locale: Locale;
  latestApprovalPacket: ReleaseRevision | null;
  onOpenReleaseModal: () => void;
  releaseEntries: ReleaseEntry[];
  selectedReleaseEntry: ReleaseEntry | null;
  onSelectRelease: (entry: ReleaseEntry) => Promise<void>;
  ui: UiCopy;
}) {
  return (
    <section className="tab-layout releases-layout">
      <div className="content-card release-list-card">
        <PanelHeading eyebrow={ui.releases.history} title={ui.releases.history} />
        <div className="mini-list">
          {releaseEntries.length > 0 ? (
            releaseEntries.map((entry) => (
              <button
                className={`release-row${selectedReleaseEntry?.key === entry.key ? " active" : ""}`}
                key={entry.key}
                onClick={() => {
                  void onSelectRelease(entry);
                }}
                type="button"
              >
                <div>
                  <strong>{entry.release.title}</strong>
                  <p>{entry.latestRevision?.summary ?? ui.releases.noRevision}</p>
                </div>
                <StatusPill tone={getStatusTone(entry.run.status)}>
                  {entry.latestRevision ? `v${entry.latestRevision.revision}` : "-"}
                </StatusPill>
              </button>
            ))
          ) : (
            <div className="empty-copy">{ui.releases.noRelease}</div>
          )}
        </div>
      </div>

      <div className="content-card release-summary-card">
        <PanelHeading
          eyebrow={ui.releases.label}
          title={selectedReleaseEntry?.release.title ?? ui.releases.label}
          action={
            <button
              className="primary-button compact"
              disabled={!selectedReleaseEntry}
              onClick={onOpenReleaseModal}
              type="button"
            >
              {locale === "ko" ? "릴리즈 열기" : "Open Release"}
            </button>
          }
        />
        {selectedReleaseEntry ? (
          <>
            <div className="release-hero">
              <div>
                <p className="eyebrow">{selectedReleaseEntry.run.title}</p>
                <h3>{selectedReleaseEntry.latestRevision?.summary ?? ui.releases.noRevision}</h3>
              </div>
              <StatusPill tone={getStatusTone(selectedReleaseEntry.run.status)}>
                {selectedReleaseEntry.latestRevision
                  ? `v${selectedReleaseEntry.latestRevision.revision}`
                  : formatStatusLabel(selectedReleaseEntry.run.status, locale)}
              </StatusPill>
            </div>

            <div className="workbench-summary">
              <MetricTile
                label={ui.releases.latestVersion}
                tone="review"
                value={
                  selectedReleaseEntry.latestRevision
                    ? `v${selectedReleaseEntry.latestRevision.revision}`
                    : "-"
                }
              />
              <MetricTile
                label={ui.releases.evidence}
                tone="queued"
                value={String(selectedReleaseEntry.run.artifacts.length)}
              />
              <MetricTile
                label={ui.releases.handoff}
                tone="running"
                value={String(selectedReleaseEntry.handoffs.length)}
              />
            </div>

            <div className="focus-card">
              <strong>
                {latestApprovalPacket?.summary ??
                  (locale === "ko"
                    ? "승인할 항목이 없습니다."
                    : "No approval item is active.")}
              </strong>
              <p>
                {activeApprovalPackets.length > 0
                  ? locale === "ko"
                    ? `${activeApprovalPackets.length}개 버전이 진행 중입니다.`
                    : `${activeApprovalPackets.length} versions are active.`
                  : ui.releases.noRevision}
              </p>
              <small>
                {activeRun?.title ??
                  (locale === "ko" ? "선택된 실행이 없습니다." : "No run is selected.")}
              </small>
            </div>
          </>
        ) : (
          <div className="empty-copy">{ui.releases.noRelease}</div>
        )}
      </div>
    </section>
  );
}

function NotesTab({
  activeRun,
  lifecycleEvents,
  locale,
  ui,
}: {
  activeRun: RunDetail | null;
  lifecycleEvents: AgentLifecycleEvent[];
  locale: Locale;
  ui: UiCopy;
}) {
  const decisions = activeRun?.decisions ?? [];
  const artifacts = activeRun?.artifacts ?? [];

  return (
    <section className="tab-layout notes-layout">
      <div className="content-card">
        <PanelHeading eyebrow={ui.notes.decisions} title={ui.notes.decisions} />
        <div className="mini-list">
          {decisions.length > 0 ? (
            decisions.map((decision) => (
              <DecisionCard decision={decision} key={decision.id} locale={locale} />
            ))
          ) : (
            <div className="empty-copy">{ui.notes.noDecisions}</div>
          )}
        </div>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.notes.artifacts} title={ui.notes.artifacts} />
        <div className="mini-list">
          {artifacts.length > 0 ? (
            artifacts.map((artifact) => (
              <div className="static-card" key={artifact.id}>
                <strong>{artifact.title}</strong>
                <p>{artifact.preview}</p>
              </div>
            ))
          ) : (
            <div className="empty-copy">{ui.notes.noArtifacts}</div>
          )}
        </div>
      </div>

      <div className="content-card">
        <PanelHeading eyebrow={ui.notes.lifecycle} title={ui.notes.lifecycle} />
        <div className="timeline-list">
          {lifecycleEvents.length > 0 ? (
            lifecycleEvents.map((event) => (
              <div className="timeline-row" key={event.id}>
                <strong>{event.summary}</strong>
                <p>
                  {formatLifecycleKind(event.kind, locale)}
                  {event.agentId ? ` • ${event.agentId}` : ""}
                  {` • ${event.createdAtLabel}`}
                </p>
              </div>
            ))
          ) : (
            <div className="empty-copy">{ui.notes.noLifecycle}</div>
          )}
        </div>
      </div>
    </section>
  );
}

function PanelHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
      </div>
      {action ? <div className="panel-heading-action">{action}</div> : null}
    </div>
  );
}

function SectionMiniTitle({ title }: { title: string }) {
  return <p className="section-mini-title">{title}</p>;
}

function MetricTile({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "running" | "review" | "queued" | "blocked";
  value: string;
}) {
  return (
    <div className={`metric-tile ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "running" | "review" | "queued" | "blocked";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function DecisionCard({
  decision,
  locale,
}: {
  decision: DecisionRecord;
  locale: Locale;
}) {
  return (
    <div className="decision-card">
      <div className="decision-head">
        <strong>{decision.summary}</strong>
        <StatusPill tone="review">
          {formatDecisionCategory(decision.category, locale)}
        </StatusPill>
      </div>
      <p>{decision.rationale}</p>
    </div>
  );
}

function getStatusTone(status: string): "running" | "review" | "queued" | "blocked" {
  if (status === "running" || status === "ready") return "running";
  if (status === "blocked" || status === "unavailable") return "blocked";
  if (status === "review" || status === "needs_review" || status === "approved") {
    return "review";
  }
  return "queued";
}

function getPhaseTone(status: "todo" | "active" | "done"): "running" | "review" | "queued" | "blocked" {
  if (status === "active") return "running";
  if (status === "done") return "review";
  return "queued";
}

function getDecisionTone(
  decision: RunAutopilotResult["decision"],
): "running" | "review" | "queued" | "blocked" {
  if (decision === "observe") return "queued";
  if (decision === "prepare_revision") return "review";
  if (decision === "prepare_revision_and_request_review") return "running";
  return "blocked";
}

function getLifecycleTone(
  kind: AgentLifecycleEvent["kind"],
): "running" | "review" | "queued" | "blocked" {
  if (kind === "blocked") return "blocked";
  if (kind === "reviewing") return "review";
  if (kind === "spawned" || kind === "resumed") return "running";
  return "queued";
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
    active: "활성",
    approved: "승인됨",
    superseded: "대체됨",
    resolved: "해결됨",
    ready: "준비됨",
    busy: "사용 중",
    cooldown: "대기 중",
    unavailable: "사용 불가",
    none: "없음",
    pending: "대기",
    done: "완료",
    todo: "예정",
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
    done: "Done",
    todo: "Todo",
  };
  return (locale === "ko" ? ko : en)[status] ?? status;
}

function formatPhaseStatus(status: "todo" | "active" | "done", locale: Locale): string {
  return formatStatusLabel(status, locale);
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

function formatLifecycleKind(kind: AgentLifecycleEvent["kind"], locale: Locale): string {
  const ko: Record<AgentLifecycleEvent["kind"], string> = {
    spawned: "시작",
    resumed: "재개",
    queued: "대기",
    blocked: "중단",
    parked: "보류",
    reviewing: "검토 중",
  };
  const en: Record<AgentLifecycleEvent["kind"], string> = {
    spawned: "Spawned",
    resumed: "Resumed",
    queued: "Queued",
    blocked: "Blocked",
    parked: "Parked",
    reviewing: "Reviewing",
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

function buildReleaseSummary(run: RunDetail, locale: Locale): string {
  const artifactCount = run.artifacts.length;
  const latestDecision = run.decisions.at(-1)?.summary;
  if (locale === "ko") {
    return `${run.title} 기준으로 산출물 ${artifactCount}개를 묶은 새 릴리즈 버전입니다.${latestDecision ? ` 결정: ${latestDecision}.` : ""}`;
  }
  return `New release version for ${run.title} built from ${artifactCount} artifacts.${latestDecision ? ` Decision: ${latestDecision}.` : ""}`;
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

function getFilePatchesForArtifact(artifact: ArtifactRecord): FilePatch[] {
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
