import type {
  Artifacts,
  BrowseResult,
  ClusterData,
  ConflictResult,
  CurationModeData,
  DaemonStats,
  DaemonStatus,
  DiscardRecord,
  DiffResult,
  GcResult,
  HivemindStats,
  ObserverStatus,
  Proposal,
  ProposalScores,
  ReadinessChecklist,
  ReindexResult,
  Task,
  UcmConfig,
  WeightProfile,
  Zettel,
  ZettelSearchResult,
} from "./types";

const BASE = "";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const rawText = await res.text();
  let data: unknown = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
  }
  if (!res.ok) {
    const detail =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error?: unknown }).error || "").trim()
        : typeof data === "string"
          ? data.trim()
          : "";
    throw new ApiError(res.status, detail || res.statusText || "Request failed");
  }
  if (data === null) {
    throw new ApiError(
      res.status,
      "empty response from server. Check daemon status and retry.",
    );
  }
  return data as T;
}

async function _requestText(
  url: string,
  options?: RequestInit,
): Promise<string> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
  });
  if (!res.ok) {
    let errorMsg = res.statusText;
    try {
      const data = await res.json();
      errorMsg = data.error || errorMsg;
    } catch {}
    throw new ApiError(res.status, errorMsg);
  }
  return res.text();
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Daemon
export const daemon = {
  status: () => request<DaemonStatus>("/api/daemon/status"),
  start: () => post<{ ok: boolean; pid: number }>("/api/daemon/start"),
  stop: () => post<{ ok: boolean }>("/api/daemon/stop"),
  pause: () => post<{ status: string }>("/api/pause"),
  resume: () => post<{ status: string }>("/api/resume"),
};

// Stats
export const stats = {
  get: () => request<DaemonStats>("/api/stats"),
};

// Tasks
export const tasks = {
  list: (status?: string) =>
    request<Task[]>(`/api/list${status ? `?status=${status}` : ""}`),
  status: (taskId: string) => request<Task>(`/api/status/${taskId}`),
  diff: (taskId: string) => request<DiffResult>(`/api/diff/${taskId}`),
  logs: (taskId: string, lines?: number) =>
    request<string>(`/api/logs/${taskId}${lines ? `?lines=${lines}` : ""}`),
  submit: (params: {
    title: string;
    body?: string;
    project?: string;
    projects?: Array<{ path: string }>;
    priority?: number;
    pipeline?: string;
  }) => post<Task>("/api/submit", params),
  start: (taskId: string) =>
    post<{ id: string; status: string }>(`/api/start/${taskId}`),
  approve: (taskId: string, score?: number) =>
    post<{ id: string; status: string }>(
      `/api/approve/${taskId}`,
      score !== undefined ? { score } : undefined,
    ),
  reject: (taskId: string, feedback?: string) =>
    post<{ id: string; status: string }>(
      `/api/reject/${taskId}`,
      feedback ? { feedback } : undefined,
    ),
  cancel: (taskId: string) =>
    post<{ id: string; status: string }>(`/api/cancel/${taskId}`),
  retry: (taskId: string) =>
    post<{ id: string; status: string }>(`/api/retry/${taskId}`),
  delete: (taskId: string) =>
    post<{ id: string; status: string }>(`/api/delete/${taskId}`),
  stageGateApprove: (taskId: string) =>
    post<{ id: string; action: string }>(`/api/stage-gate/approve/${taskId}`),
  stageGateReject: (taskId: string, feedback?: string) =>
    post<{ id: string; action: string }>(
      `/api/stage-gate/reject/${taskId}`,
      feedback ? { feedback } : undefined,
    ),
  updatePriority: (taskId: string, priority: number) =>
    post<{ id: string; priority: number }>(`/api/priority/${taskId}`, {
      priority,
    }),
};

// Artifacts
export const artifacts = {
  get: (taskId: string) => request<Artifacts>(`/api/artifacts/${taskId}`),
};

// Proposals
export const proposals = {
  list: (status?: string) =>
    request<Proposal[]>(`/api/proposals${status ? `?status=${status}` : ""}`),
  evaluate: (proposalId: string) =>
    request<{
      proposalId: string;
      status: string;
      evaluation: unknown;
      baselineSnapshot: unknown;
    }>(`/api/proposal/${proposalId}`),
  approve: (proposalId: string) =>
    post<{ proposalId: string; status: string; taskId?: string }>(
      `/api/proposal/approve/${proposalId}`,
    ),
  reject: (proposalId: string) =>
    post<{ proposalId: string; status: string }>(
      `/api/proposal/reject/${proposalId}`,
    ),
  delete: (proposalId: string) =>
    post<{ proposalId: string; status: string }>(
      `/api/proposal/delete/${proposalId}`,
    ),
  priority: (proposalId: string, delta: number) =>
    post<{ proposalId: string; priority: number }>(
      `/api/proposal/priority/${proposalId}`,
      { delta },
    ),
  score: (proposalId: string) =>
    request<{ proposalId: string; scores: ProposalScores | null; priority: number; scoreSource: string | null; weightProfile: string | null }>(
      `/api/proposal/score/${proposalId}`,
    ),
  setScore: (proposalId: string, scores: Partial<ProposalScores>) =>
    post<{ proposalId: string; scores: ProposalScores; priority: number }>(
      `/api/proposal/score/${proposalId}`,
      { scores },
    ),
  clusters: (refresh?: boolean) =>
    request<ClusterData>(`/api/proposal/clusters${refresh ? "?refresh=1" : ""}`),
  mergeCluster: (proposalIds: string[], representativeId?: string) =>
    post<unknown>("/api/proposal/cluster/merge", { proposalIds, representativeId }),
  splitCluster: (proposalId: string) =>
    post<unknown>(`/api/proposal/cluster/split/${proposalId}`),
  conflicts: (proposalId: string) =>
    request<ConflictResult>(`/api/proposal/conflicts/${proposalId}`),
  discard: (proposalId: string, reason: string) =>
    post<{ proposalId: string; discarded: boolean }>(
      `/api/proposal/discard/${proposalId}`,
      { reason, discardedBy: "user" },
    ),
  discardHistory: (limit?: number) =>
    request<{ records: DiscardRecord[]; total: number }>(
      `/api/proposal/discard-history${limit ? `?limit=${limit}` : ""}`,
    ),
  readiness: (proposalId: string) =>
    request<ReadinessChecklist>(`/api/proposal/readiness/${proposalId}`),
  feedback: (proposalId: string, taskId: string, outcome: Record<string, unknown>) =>
    post<unknown>(`/api/proposal/feedback/${proposalId}`, { taskId, outcome }),
};

// Curation
export const curation = {
  mode: () => request<CurationModeData>("/api/curation/mode"),
  setMode: (mode: string, reason?: string) =>
    post<CurationModeData>("/api/curation/mode", { mode, reason }),
  weights: () =>
    request<{ activeProfile: string; profiles: WeightProfile[] }>("/api/curation/weights"),
  setWeights: (params: { profile?: string; weights?: Record<string, number> }) =>
    post<{ activeProfile: string; weights?: Record<string, number>; profiles?: WeightProfile[] }>("/api/curation/weights", params),
  profiles: () => request<WeightProfile[]>("/api/curation/profiles"),
};

// Observer
export const observer = {
  status: () => request<ObserverStatus>("/api/observe/status"),
  run: () => post<{ ok: boolean }>("/api/observe"),
  analyze: (project: string) => post<unknown>("/api/analyze", { project }),
  research: (project: string) => post<unknown>("/api/research", { project }),
};

// Browse
export const browse = {
  list: (path?: string, showHidden?: boolean) =>
    request<BrowseResult>(
      `/api/browse?path=${encodeURIComponent(path || "")}&showHidden=${showHidden ? "1" : "0"}`,
    ),
  mkdir: (path: string) => post<{ created: string }>("/api/mkdir", { path }),
  gitInit: (path: string) =>
    post<{ path: string; initialized?: boolean; alreadyGit?: boolean }>(
      "/api/git-init",
      { path },
    ),
};

// Refinement
export const refinement = {
  start: (params: {
    taskId?: string;
    title: string;
    description?: string;
    body?: string;
    project?: string;
    pipeline?: string;
    mode?: "interactive" | "autopilot";
  }) => {
    const { description, body, ...rest } = params;
    const normalizedDescription =
      typeof description === "string"
        ? description.trim()
        : description == null
          ? ""
          : String(description).trim();
    const normalizedBody =
      typeof body === "string"
        ? body.trim()
        : body == null
          ? ""
          : String(body).trim();
    return post<unknown>("/api/refinement/start", {
      ...rest,
      description: normalizedDescription || normalizedBody,
    });
  },
  finalize: (params: { sessionId: string; answers: Record<string, string> }) =>
    post<unknown>("/api/refinement/finalize", params),
  autopilot: (params: { sessionId: string }) =>
    post<unknown>("/api/refinement/autopilot", params),
  cancel: (params: { sessionId: string }) =>
    post<unknown>("/api/refinement/cancel", params),
};

// Config
export const config = {
  get: () => request<UcmConfig>("/api/config"),
  set: (params: Partial<UcmConfig>) => post<UcmConfig>("/api/config", params),
};

// Automation
export interface AutomationConfig {
  autoExecute: boolean;
  autoApprove: boolean;
  autoPropose: boolean;
  autoConvert: boolean;
  projects: Record<string, Partial<{ autoExecute: boolean | null; autoApprove: boolean | null; autoPropose: boolean | null; autoConvert: boolean | null }>>;
}

export const automation = {
  get: () => request<AutomationConfig>("/api/automation"),
  set: (params: Partial<AutomationConfig>) => post<UcmConfig>("/api/automation", params),
};

// Hivemind
export const hivemind = {
  start: () => post<{ ok: boolean; running: boolean }>("/api/hivemind/start"),
  stop: () => post<{ ok: boolean; running: boolean }>("/api/hivemind/stop"),
  search: (query: string, limit?: number) =>
    request<ZettelSearchResult[]>(
      `/api/hivemind/search?q=${encodeURIComponent(query)}&limit=${limit || 20}`,
    ),
  list: (kind?: string, limit?: number) =>
    request<Zettel[]>(
      `/api/hivemind/list?kind=${encodeURIComponent(kind || "")}&limit=${limit || 100}`,
    ),
  show: (id: string) =>
    request<Zettel>(`/api/hivemind/show/${encodeURIComponent(id)}`),
  stats: () => request<HivemindStats>("/api/hivemind/stats"),
  delete: (id: string) =>
    post<{ deleted: string }>(`/api/hivemind/delete/${encodeURIComponent(id)}`),
  restore: (id: string) =>
    post<{ restored: string }>(`/api/hivemind/restore/${encodeURIComponent(id)}`),
  gc: (dryRun?: boolean) =>
    post<GcResult>("/api/hivemind/gc", { dryRun: dryRun ?? false }),
  reindex: () => post<ReindexResult>("/api/hivemind/reindex"),
};

// Cleanup
export const cleanup = {
  run: (params?: { retentionDays?: number }) =>
    post<unknown>("/api/cleanup", params),
};

export const api = {
  daemon,
  stats,
  tasks,
  artifacts,
  proposals,
  curation,
  observer,
  browse,
  refinement,
  cleanup,
  config,
  automation,
  hivemind,
};

export default api;
