import { useEffect, useState } from "react";
import type {
  ExecutionAttempt,
  MissionSnapshot,
  ShellSnapshot,
  RunDetail,
  SessionLease,
  WakeupRequest,
  WorkspaceSummary,
  WorkspaceBrowserSnapshot,
  WorkspaceBrowserEntry,
} from "@shared/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Stage = "workspace" | "mission" | "control";

function App() {
  const [stage, setStage] = useState<Stage>("workspace");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [missions, setMissions] = useState<MissionSnapshot[]>([]);

  // browser modal
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserSnapshot, setBrowserSnapshot] =
    useState<WorkspaceBrowserSnapshot | null>(null);
  const [newDirName, setNewDirName] = useState("");
  const [creating, setCreating] = useState(false);

  // active run for control stage
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [shellSnapshot, setShellSnapshot] = useState<ShellSnapshot | null>(null);
  const [wakeupRequests, setWakeupRequests] = useState<WakeupRequest[]>([]);
  const [executionAttempts, setExecutionAttempts] = useState<ExecutionAttempt[]>([]);
  const [sessionLeases, setSessionLeases] = useState<SessionLease[]>([]);

  // mission form
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");

  const activeWorkspace = workspaces.find((w) => w.active);

  useEffect(() => {
    void loadWorkspaces();
    // subscribe to runtime updates for live refresh
    const unsub = window.ucm.events.onRuntimeUpdate(() => {
      void loadMissions();
      void loadActiveRun();
    });
    return () => unsub();
  }, []);

  // auto-advance: if workspace is already selected, go to mission stage
  useEffect(() => {
    if (workspaces.length > 0 && activeWorkspace) {
      if (stage === "workspace") setStage("mission");
      void loadMissions();
    }
  }, [workspaces]);

  async function loadWorkspaces() {
    const list = await window.ucm.workspace.list();
    setWorkspaces(list);
  }

  async function loadMissions() {
    const list = await window.ucm.mission.list();
    setMissions(list);
  }

  async function loadActiveRun() {
    const [run, shell] = await Promise.all([
      window.ucm.run.getActive(),
      window.ucm.shell.getSnapshot(),
    ]);
    setActiveRun(run);
    setShellSnapshot(shell);
    if (!run) {
      setWakeupRequests([]);
      setExecutionAttempts([]);
      setSessionLeases([]);
      return;
    }
    const [nextWakeups, nextAttempts, nextLeases] = await Promise.all([
      window.ucm.run.listWakeupRequests({ runId: run.id }),
      window.ucm.run.listExecutionAttempts({ runId: run.id }),
      window.ucm.run.listSessionLeases({ runId: run.id }),
    ]);
    setWakeupRequests(nextWakeups);
    setExecutionAttempts(nextAttempts);
    setSessionLeases(nextLeases);
  }

  async function handleSelectWorkspace(id: string) {
    await window.ucm.workspace.setActive({ workspaceId: id });
    await loadWorkspaces();
    setStage("mission");
    await loadMissions();
  }

  async function openBrowser() {
    const snapshot = await window.ucm.workspace.browse();
    setBrowserSnapshot(snapshot);
    setBrowserOpen(true);
  }

  async function navigateTo(path: string) {
    const snapshot = await window.ucm.workspace.browse({ rootPath: path });
    setBrowserSnapshot(snapshot);
  }

  async function selectDirectory(entry: WorkspaceBrowserEntry) {
    await window.ucm.workspace.add({ rootPath: entry.path });
    await window.ucm.workspace.setActive({ workspaceId: entry.path });
    await loadWorkspaces();
    setBrowserOpen(false);
    setStage("mission");
    await loadMissions();
  }

  async function handleCreateDir() {
    if (!browserSnapshot || !newDirName.trim()) return;
    setCreating(true);
    try {
      const snapshot = await window.ucm.workspace.createDirectory({
        parentPath: browserSnapshot.currentPath,
        directoryName: newDirName.trim(),
      });
      setBrowserSnapshot(snapshot);
      setNewDirName("");
    } catch {
      // directory might already exist
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateMission(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !title.trim() || !goal.trim()) return;
    try {
      await window.ucm.mission.create({
        workspaceId: activeWorkspace.id,
        title: title.trim(),
        goal: goal.trim(),
      });
      setTitle("");
      setGoal("");
      await loadMissions();
      await loadActiveRun();
      setStage("control");
    } catch (err) {
      console.error("mission create failed:", err);
    }
  }

  async function handleOpenMission(missionId: string) {
    await window.ucm.mission.setActive({ missionId });
    await loadMissions();
    await loadActiveRun();
    setStage("control");
  }

  if (stage === "workspace") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <div className="w-full max-w-2xl space-y-8">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">
              UCM
            </h1>
            <p className="text-muted-foreground">
              프로젝트 폴더를 선택하면 미션을 시작할 수 있습니다.
            </p>
          </div>

          <div className="space-y-3">
            {workspaces.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  등록된 워크스페이스가 없습니다.
                </p>
                <p className="text-xs text-muted-foreground">
                  아래 버튼으로 프로젝트 폴더를 추가하세요.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  워크스페이스 ({workspaces.length})
                </p>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => handleSelectWorkspace(ws.id)}
                    className={`group w-full rounded-lg border p-4 text-left transition-all duration-150 ${
                      ws.active
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border bg-card hover:border-primary/50 hover:bg-primary/[0.02] hover:ring-1 hover:ring-primary/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {ws.name}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {ws.rootPath}
                        </p>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                          ws.active
                            ? "bg-primary/10 text-primary"
                            : "bg-transparent text-transparent group-hover:bg-muted group-hover:text-muted-foreground"
                        }`}
                      >
                        {ws.active ? "활성" : "열기 →"}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>

          <Button onClick={openBrowser} className="w-full" size="lg">
            워크스페이스 추가
          </Button>

          <DirectoryBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            snapshot={browserSnapshot}
            newDirName={newDirName}
            creating={creating}
            onNavigate={navigateTo}
            onSelect={selectDirectory}
            onNewDirNameChange={setNewDirName}
            onCreateDir={handleCreateDir}
          />
        </div>
      </div>
    );
  }

  // Stage: mission
  if (stage === "mission") return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header with back button */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStage("workspace")}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
            >
              ← 워크스페이스
            </button>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            {activeWorkspace?.name ?? "UCM"}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {activeWorkspace?.rootPath}
          </p>
        </div>

        {/* Mission create form */}
        <form onSubmit={handleCreateMission} className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            새 미션
          </p>
          <div className="space-y-3">
            <Input
              placeholder="미션 제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="목표 — 이 미션이 달성해야 할 것"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={!title.trim() || !goal.trim()}
          >
            미션 시작
          </Button>
        </form>

        {/* Existing missions */}
        {missions.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              기존 미션 ({missions.length})
            </p>
            {missions.map((m) => (
              <button
                key={m.id}
                onClick={() => handleOpenMission(m.id)}
                className="group w-full rounded-lg border border-border bg-card p-4 text-left transition-all duration-150 hover:border-primary/50 hover:bg-primary/[0.02] hover:ring-1 hover:ring-primary/10"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          m.status === "completed"
                            ? "bg-green-400"
                            : m.status === "blocked"
                              ? "bg-red-400 animate-pulse"
                              : m.status === "running"
                                ? "bg-blue-400 animate-pulse"
                                : m.status === "review"
                                  ? "bg-yellow-400"
                                  : "bg-zinc-500"
                        }`}
                      />
                      <p className="text-sm font-medium text-foreground">
                        {m.title}
                      </p>
                    </div>
                    {m.latestResult && (
                      <p className="text-xs text-muted-foreground line-clamp-1 pl-4">
                        {m.latestResult}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={m.status} />
                    <span className="text-xs text-transparent transition-colors group-hover:text-muted-foreground">
                      →
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

      </div>
    </div>
  );

  // Stage: control
  if (stage === "control") {
    const run = activeRun;
    const terminalLines = run?.terminalPreview ?? [];
    const events = [...(run?.runEvents ?? [])].reverse();
    const latestDeliverable = run?.deliverables?.[0] ?? null;
    const latestRevision = latestDeliverable?.revisions.find(
      (r) => r.id === latestDeliverable.latestRevisionId,
    ) ?? null;
    const latestAttempt = executionAttempts.at(-1) ?? null;
    const canApprove = latestRevision?.status === "active";
    const isBlocked = run?.status === "blocked";
    const isRunning = run?.status === "running";
    const isQueued = run?.status === "queued";
    const needsReview = run?.status === "needs_review" || canApprove;

    async function handleApprove() {
      if (!run) return;
      try {
        // If no deliverable exists yet, generate one first
        let revisionId = latestRevision?.id;
        if (!revisionId) {
          const delId = `del-${run.id}`;
          const updated = await window.ucm.deliverable.generate({
            runId: run.id,
            deliverableId: delId,
            summary: "에이전트 결과물 승인 준비",
          });
          const newDel = updated?.deliverables?.[0];
          revisionId = newDel?.latestRevisionId;
        }
        if (revisionId) {
          await window.ucm.deliverable.approve({
            runId: run.id,
            deliverableRevisionId: revisionId,
          });
        }
      } catch (err) {
        console.error("approve failed:", err);
      }
      await loadMissions();
      await loadActiveRun();
    }

    // Determine what the user should know / do right now
    const actionMessage = !run
      ? { label: "대기", desc: "에이전트가 아직 할당되지 않았습니다.", color: "zinc" as const }
      : isQueued
        ? { label: "대기 중", desc: "에이전트가 실행 큐에서 순서를 기다리고 있습니다. 자동으로 시작됩니다.", color: "zinc" as const }
        : isRunning
          ? { label: "실행 중", desc: "에이전트가 작업 중입니다. 완료되면 알려드립니다.", color: "blue" as const }
          : isBlocked
            ? { label: "차단됨", desc: "에이전트가 진행할 수 없습니다. 입력이 필요합니다.", color: "red" as const }
            : needsReview
              ? { label: "검토 필요", desc: "에이전트가 결과물을 만들었습니다. 확인 후 승인하세요.", color: "yellow" as const }
              : run.status === "completed"
                ? { label: "완료", desc: "미션이 완료되었습니다.", color: "green" as const }
                : { label: run.status, desc: "", color: "zinc" as const };

    const dotColor = {
      zinc: "bg-zinc-500",
      blue: "bg-blue-400 animate-pulse",
      red: "bg-red-400 animate-pulse",
      yellow: "bg-yellow-400",
      green: "bg-green-400",
    }[actionMessage.color];

    const borderColor = {
      zinc: "border-border",
      blue: "border-blue-500/20",
      red: "border-red-500/20",
      yellow: "border-yellow-500/20",
      green: "border-green-500/20",
    }[actionMessage.color];

    return (
      <div className="flex min-h-screen bg-background p-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {/* Back */}
          <button
            onClick={() => setStage("mission")}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-95"
          >
            ← 미션 목록
          </button>

          {/* Action card — the most important thing on screen */}
          <div className={`rounded-lg border ${borderColor} bg-card p-6 space-y-3`}>
            <div className="flex items-center gap-3">
              <span className={`inline-block h-3 w-3 rounded-full ${dotColor}`} />
              <h1 className="text-xl font-bold text-foreground">
                {actionMessage.label}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {actionMessage.desc}
            </p>

            {/* Approval action */}
            {needsReview && (
              <div className="pt-2 space-y-2">
                {latestRevision && (
                  <p className="text-xs text-muted-foreground">
                    {latestRevision.summary}
                  </p>
                )}
                <Button onClick={() => void handleApprove()} size="lg">
                  결과물 승인
                </Button>
              </div>
            )}
          </div>

          {/* Mission info */}
          {run && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-1">
              <p className="text-sm font-medium text-foreground">
                {cleanTitle(run.title)}
              </p>
            </div>
          )}

          {/* Terminal — only show if there's output */}
          {terminalLines.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                에이전트 출력
              </p>
              <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-[#08090b] p-4 font-mono text-xs leading-relaxed text-zinc-300">
                {terminalLines.join("\n")}
              </pre>
            </div>
          )}

          {/* Artifacts — show what was actually produced */}
          {run && run.artifacts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                결과물
              </p>
              <div className="space-y-3">
                {run.artifacts
                  .filter((a) => a.preview && a.type !== "handoff" && !a.title.startsWith("Run trace") && !a.title.startsWith("Decision "))
                  .map((a) => (
                    <div key={a.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        {cleanTitle(a.title)}
                      </p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {a.preview}
                      </p>
                      {a.filePatches && a.filePatches.length > 0 && (
                        <div className="space-y-2 pt-2">
                          {a.filePatches.map((patch) => (
                            <div key={patch.path} className="space-y-1">
                              <p className="font-mono text-xs text-primary">
                                {patch.path}
                              </p>
                              {patch.summary && (
                                <p className="text-xs text-muted-foreground">{patch.summary}</p>
                              )}
                              <pre className="max-h-40 overflow-auto rounded border border-border bg-[#08090b] p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                                {patch.patch}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Recent events — compact, translated */}
          {events.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                진행 기록
              </p>
              <div className="space-y-1">
                {events.slice(0, 5).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-2 py-1">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        ev.kind === "completed" ? "bg-green-400"
                          : ev.kind === "blocked" ? "bg-red-400"
                          : ev.kind === "needs_review" || ev.kind === "review_requested" ? "bg-yellow-400"
                          : ev.kind === "artifact_created" ? "bg-blue-400"
                          : "bg-zinc-500"
                      }`}
                    />
                    <p className="text-xs text-muted-foreground truncate">
                      {translateEvent(ev.kind, ev.summary)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(executionAttempts.length > 0 || wakeupRequests.length > 0 || sessionLeases.length > 0) && (
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                운영 상태
              </p>

              {shellSnapshot && shellSnapshot.providerWindows.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Provider Windows
                  </p>
                  <div className="space-y-2">
                    {shellSnapshot.providerWindows.map((window) => (
                      <div
                        key={window.provider}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-foreground">
                            {window.provider} · {formatProviderWindowStatus(window.status)}
                          </p>
                          <p className="truncate text-muted-foreground">
                            warm: {window.warmLeaseCount ?? 0} · resumable: {window.resumableLeaseCount ?? 0} · queued: {window.queuedRuns}
                          </p>
                        </div>
                        <div className="shrink-0 flex flex-wrap justify-end gap-2">
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${providerWindowStatusBadgeClass(window.status)}`}>
                            {formatProviderWindowStatus(window.status)}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${providerWindowStrategyBadgeClass(window.sessionStrategy)}`}>
                            {formatSessionStrategy(window.sessionStrategy)}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${providerWindowResumeBadgeClass(window.resumeSupport)}`}>
                            {formatResumeSupport(window.resumeSupport)}
                          </span>
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {window.nextAvailableLabel}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {latestAttempt && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">
                      최근 실행 시도
                    </p>
                    <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {latestAttempt.status}
                    </span>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                    <p>attempt #{latestAttempt.attemptNumber}</p>
                    <p>provider: {latestAttempt.provider}</p>
                    <p>tokens: {latestAttempt.estimatedPromptTokens ?? "n/a"}</p>
                    <p>latency: {formatMs(latestAttempt.latencyMs)}</p>
                    <p>session: {latestAttempt.sessionId ?? "n/a"}</p>
                    <p>output chars: {latestAttempt.outputChars ?? "n/a"}</p>
                  </div>
                </div>
              )}

              {wakeupRequests.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Wakeup Queue
                  </p>
                  <div className="space-y-2">
                    {[...wakeupRequests].reverse().slice(0, 4).map((request) => (
                      <div
                        key={request.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-foreground">
                            {request.source}
                          </p>
                          <p className="truncate text-muted-foreground">
                            {request.reason ?? request.id}
                          </p>
                        </div>
                        <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {request.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sessionLeases.length > 0 && (
                <div className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Session Leases
                  </p>
                  <div className="space-y-2">
                    {sessionLeases.slice(0, 4).map((lease) => (
                      <div
                        key={lease.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-foreground">
                            {lease.provider} · {lease.affinityKey ?? lease.id}
                          </p>
                          <p className="truncate text-muted-foreground">
                            session: {lease.sessionId ?? "unbound"}
                          </p>
                          <p className="truncate text-muted-foreground">
                            policy: {lease.reusePolicy}
                          </p>
                          <p className="truncate text-muted-foreground">
                            last attempt: {lease.lastAttemptId ?? "none"}
                          </p>
                        </div>
                        <div className="shrink-0 flex flex-wrap justify-end gap-2">
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${leaseStatusBadgeClass(lease.status)}`}>
                            {lease.status}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${leaseResumeBadgeClass(lease.resumable)}`}>
                            {lease.resumable ? "resume ready" : "resume unavailable"}
                          </span>
                          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${leaseRotationBadgeClass(lease.rotationReason)}`}>
                            {formatLeaseRotationReason(lease.rotationReason)}
                          </span>
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {lease.reusePolicy}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // unreachable fallback
  return null;
}

function DirectoryBrowserDialog({
  open,
  onOpenChange,
  snapshot,
  newDirName,
  creating,
  onNavigate,
  onSelect,
  onNewDirNameChange,
  onCreateDir,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: WorkspaceBrowserSnapshot | null;
  newDirName: string;
  creating: boolean;
  onNavigate: (path: string) => void;
  onSelect: (entry: WorkspaceBrowserEntry) => void;
  onNewDirNameChange: (name: string) => void;
  onCreateDir: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>디렉토리 선택</DialogTitle>
        </DialogHeader>

        {snapshot && (
          <div className="space-y-4">
            <div className="rounded border border-border bg-muted px-3 py-2">
              <p className="font-mono text-xs text-muted-foreground">
                {snapshot.currentPath}
              </p>
            </div>

            <div className="flex gap-2">
              {snapshot.parentPath && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate(snapshot.parentPath!)}
                >
                  상위 폴더
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onNavigate(snapshot.homePath)}
              >
                홈
              </Button>
            </div>

            <ScrollArea className="h-72 rounded border border-border">
              <div className="divide-y divide-border">
                {snapshot.directories.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    하위 디렉토리가 없습니다.
                  </div>
                ) : (
                  snapshot.directories.map((entry) => (
                    <div
                      key={entry.path}
                      className="group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/50"
                    >
                      <button
                        onClick={() => onNavigate(entry.path)}
                        className="flex-1 text-left"
                      >
                        <span className="text-sm text-foreground transition-colors group-hover:text-primary">
                          {entry.name}
                        </span>
                        {entry.isRepositoryRoot && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            repo
                          </span>
                        )}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onSelect(entry)}
                        className="text-xs opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        선택
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                placeholder="새 폴더 이름"
                value={newDirName}
                onChange={(e) => onNewDirNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCreateDir();
                  }
                }}
              />
              <Button
                onClick={onCreateDir}
                disabled={!newDirName.trim() || creating}
                variant="outline"
              >
                생성
              </Button>
            </div>

            <Button
              className="w-full"
              onClick={() =>
                onSelect({
                  name: snapshot.currentPath.split("/").pop() || "",
                  path: snapshot.currentPath,
                  isRepositoryRoot: false,
                })
              }
            >
              현재 폴더를 워크스페이스로 선택
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Strip internal role prefixes from titles */
function cleanTitle(title: string): string {
  return title
    .replace(/^Plan\s+/, "")
    .replace(/^Build\s+/, "")
    .replace(/^Verify\s+/, "")
    .replace(/\s+review packet.*$/i, "")
    .trim();
}

/** Translate system event messages to Korean */
function translateEvent(kind: string, summary: string): string {
  const kindMap: Record<string, string> = {
    artifact_created: "산출물 생성",
    completed: "완료",
    blocked: "차단됨",
    needs_review: "검토 필요",
    review_requested: "검토 요청",
    steering_requested: "입력 요청",
    steering_submitted: "입력 완료",
    agent_status_changed: "에이전트 상태 변경",
  };
  const prefix = kindMap[kind] ?? kind;
  // If summary is meaningful Korean, use it; otherwise just use prefix
  if (/[가-힣]/.test(summary)) return summary;
  // Translate common English patterns
  if (/planner produced a spec/i.test(summary)) return `${prefix} — 스펙 작성 완료`;
  if (/planner parked/i.test(summary)) return `${prefix} — 계획 단계 종료`;
  if (/builder resumed/i.test(summary)) return `${prefix} — 빌드 시작`;
  if (/planner assessment/i.test(summary)) return `${prefix} — 플래너 평가 완료`;
  return `${prefix}`;
}

function formatMs(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatLeaseRotationReason(reason?: string): string {
  if (!reason) {
    return "steady";
  }
  if (reason === "ephemeral_policy") {
    return "ephemeral";
  }
  return reason.replaceAll("_", " ");
}

function formatSessionStrategy(strategy?: string): string {
  if (strategy === "persistent_terminal") {
    return "persistent session";
  }
  if (strategy === "live_terminal") {
    return "live terminal";
  }
  if (strategy === "pipe_only") {
    return "pipe only";
  }
  return "unknown strategy";
}

function formatResumeSupport(support?: string): string {
  if (support === "persistent_terminal") {
    return "full resume";
  }
  if (support === "live_terminal") {
    return "live resume";
  }
  if (support === "none") {
    return "no resume";
  }
  return "unknown resume";
}

function formatProviderWindowStatus(status?: string): string {
  if (status === "ready") {
    return "ready";
  }
  if (status === "busy") {
    return "running";
  }
  if (status === "cooldown") {
    return "queued";
  }
  if (status === "unavailable") {
    return "offline";
  }
  return status ?? "unknown";
}

function providerWindowStatusBadgeClass(status?: string): string {
  if (status === "busy") {
    return "bg-blue-500/10 text-blue-400";
  }
  if (status === "cooldown") {
    return "bg-amber-500/10 text-amber-400";
  }
  if (status === "unavailable") {
    return "bg-red-500/10 text-red-400";
  }
  if (status === "ready") {
    return "bg-green-500/10 text-green-400";
  }
  return "bg-zinc-500/10 text-zinc-400";
}

function providerWindowStrategyBadgeClass(strategy?: string): string {
  if (strategy === "persistent_terminal") {
    return "bg-emerald-500/10 text-emerald-400";
  }
  if (strategy === "live_terminal") {
    return "bg-cyan-500/10 text-cyan-400";
  }
  if (strategy === "pipe_only") {
    return "bg-zinc-500/10 text-zinc-400";
  }
  return "bg-zinc-500/10 text-zinc-400";
}

function providerWindowResumeBadgeClass(support?: string): string {
  if (support === "persistent_terminal") {
    return "bg-emerald-500/10 text-emerald-400";
  }
  if (support === "live_terminal") {
    return "bg-blue-500/10 text-blue-400";
  }
  if (support === "none") {
    return "bg-zinc-500/10 text-zinc-400";
  }
  return "bg-zinc-500/10 text-zinc-400";
}

function leaseStatusBadgeClass(status?: string): string {
  if (status === "warm") {
    return "bg-green-500/10 text-green-400";
  }
  if (status === "busy") {
    return "bg-blue-500/10 text-blue-400";
  }
  if (status === "cooldown") {
    return "bg-amber-500/10 text-amber-400";
  }
  if (status === "expired") {
    return "bg-red-500/10 text-red-400";
  }
  return "bg-zinc-500/10 text-zinc-400";
}

function leaseResumeBadgeClass(resumable?: boolean): string {
  return resumable
    ? "bg-emerald-500/10 text-emerald-400"
    : "bg-zinc-500/10 text-zinc-400";
}

function leaseRotationBadgeClass(reason?: string): string {
  if (reason === "ephemeral_policy") {
    return "bg-amber-500/10 text-amber-400";
  }
  if (!reason) {
    return "bg-green-500/10 text-green-400";
  }
  return "bg-zinc-500/10 text-zinc-400";
}

const statusLabels: Record<string, string> = {
  running: "실행 중",
  queued: "대기 중",
  blocked: "차단됨",
  review: "검토 대기",
  completed: "완료",
  needs_review: "검토 필요",
};

const statusColors: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-400",
  queued: "bg-zinc-500/10 text-zinc-400",
  blocked: "bg-red-500/10 text-red-400",
  review: "bg-yellow-500/10 text-yellow-400",
  completed: "bg-green-500/10 text-green-400",
  needs_review: "bg-yellow-500/10 text-yellow-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-medium ${statusColors[status] ?? "bg-zinc-500/10 text-zinc-400"}`}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}

export default App;
