import type {
  Task, DaemonStats, DiffResult, Artifacts, Proposal,
  ObserverStatus, AutopilotSession, AutopilotSessionSummary,
  BrowseResult, DaemonStatus, Release, Directive,
  UcmConfig,
} from "./types";

const BASE = "";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, data.error || res.statusText);
  }
  return data as T;
}

async function requestText(url: string, options?: RequestInit): Promise<string> {
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
  submit: (params: { title: string; body?: string; project?: string; projects?: Array<{ path: string }>; priority?: number; pipeline?: string }) =>
    post<Task>("/api/submit", params),
  start: (taskId: string) => post<{ id: string; status: string }>(`/api/start/${taskId}`),
  approve: (taskId: string, score?: number) =>
    post<{ id: string; status: string }>(`/api/approve/${taskId}`, score !== undefined ? { score } : undefined),
  reject: (taskId: string, feedback?: string) =>
    post<{ id: string; status: string }>(`/api/reject/${taskId}`, feedback ? { feedback } : undefined),
  cancel: (taskId: string) => post<{ id: string; status: string }>(`/api/cancel/${taskId}`),
  retry: (taskId: string) => post<{ id: string; status: string }>(`/api/retry/${taskId}`),
  delete: (taskId: string) => post<{ id: string; status: string }>(`/api/delete/${taskId}`),
  stageGateApprove: (taskId: string) =>
    post<{ id: string; action: string }>(`/api/stage-gate/approve/${taskId}`),
  stageGateReject: (taskId: string, feedback?: string) =>
    post<{ id: string; action: string }>(`/api/stage-gate/reject/${taskId}`, feedback ? { feedback } : undefined),
  updatePriority: (taskId: string, priority: number) =>
    post<{ id: string; priority: number }>(`/api/priority/${taskId}`, { priority }),
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
    request<{ proposalId: string; status: string; evaluation: unknown; baselineSnapshot: unknown }>(`/api/proposal/${proposalId}`),
  approve: (proposalId: string) =>
    post<{ proposalId: string; status: string; taskId?: string }>(`/api/proposal/approve/${proposalId}`),
  reject: (proposalId: string) =>
    post<{ proposalId: string; status: string }>(`/api/proposal/reject/${proposalId}`),
  priority: (proposalId: string, delta: number) =>
    post<{ proposalId: string; priority: number }>(`/api/proposal/priority/${proposalId}`, { delta }),
};

// Observer
export const observer = {
  status: () => request<ObserverStatus>("/api/observe/status"),
  run: () => post<{ ok: boolean }>("/api/observe"),
  analyze: (project: string) => post<unknown>("/api/analyze", { project }),
  research: (project: string) => post<unknown>("/api/research", { project }),
};

// Autopilot
export const autopilot = {
  status: () => request<AutopilotSessionSummary[]>("/api/autopilot/status"),
  session: (sessionId: string) => request<AutopilotSession>(`/api/autopilot/session/${sessionId}`),
  start: (params: { project: string; pipeline?: string; maxItems?: number }) =>
    post<{ sessionId: string; project: string; status: string }>("/api/autopilot/start", params),
  pause: (sessionId: string) => post<{ sessionId: string; status: string }>("/api/autopilot/pause", { sessionId }),
  resume: (sessionId: string) => post<{ sessionId: string; status: string }>("/api/autopilot/resume", { sessionId }),
  stop: (sessionId: string) => post<{ sessionId: string; status: string }>("/api/autopilot/stop", { sessionId }),
  approveItem: (sessionId: string) => post<{ sessionId: string; action: string }>("/api/autopilot/approve-item", { sessionId }),
  rejectItem: (sessionId: string) => post<{ sessionId: string; action: string }>("/api/autopilot/reject-item", { sessionId }),
  feedbackItem: (sessionId: string, feedback: string) =>
    post<{ sessionId: string; action: string }>("/api/autopilot/feedback-item", { sessionId, feedback }),
  releases: (sessionId: string) =>
    request<{ sessionId: string; releases: Release[]; stableTags: string[] }>(`/api/autopilot/releases/${sessionId}`),
  directives: {
    list: (sessionId: string, status?: string) =>
      request<{ sessionId: string; directives: Directive[] }>(
        `/api/autopilot/directives/${sessionId}${status ? `?status=${status}` : ""}`
      ),
    add: (sessionId: string, text: string) =>
      post<{ sessionId: string; directive: Directive }>("/api/autopilot/directive/add", { sessionId, text }),
    edit: (sessionId: string, directiveId: string, text: string) =>
      post<{ sessionId: string; directive: Directive }>("/api/autopilot/directive/edit", { sessionId, directiveId, text }),
    delete: (sessionId: string, directiveId: string) =>
      post<{ sessionId: string; directiveId: string }>("/api/autopilot/directive/delete", { sessionId, directiveId }),
  },
};

// Browse
export const browse = {
  list: (path?: string, showHidden?: boolean) =>
    request<BrowseResult>(`/api/browse?path=${encodeURIComponent(path || "")}&showHidden=${showHidden ? "1" : "0"}`),
  mkdir: (path: string) => post<{ created: string; gitInit: boolean }>("/api/mkdir", { path }),
};

// Refinement
export const refinement = {
  start: (params: { taskId?: string; title: string; body: string; project?: string }) =>
    post<unknown>("/api/refinement/start", params),
  finalize: (params: { sessionId: string; answers: Record<string, string> }) =>
    post<unknown>("/api/refinement/finalize", params),
  cancel: (params: { sessionId: string }) =>
    post<unknown>("/api/refinement/cancel", params),
};

// Config
export const config = {
  get: () => request<UcmConfig>("/api/config"),
  set: (params: Partial<UcmConfig>) => post<UcmConfig>("/api/config", params),
};

// Cleanup
export const cleanup = {
  run: (params?: { retentionDays?: number }) => post<unknown>("/api/cleanup", params),
};

export const api = {
  daemon, stats, tasks, artifacts, proposals,
  observer, autopilot, browse, refinement, cleanup, config,
};

export default api;
