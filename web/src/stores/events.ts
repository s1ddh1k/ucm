import { create } from "zustand";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  event: string;
  data: Record<string, unknown>;
}

interface EventsState {
  activities: ActivityEvent[];
  taskLogs: Map<string, string[]>;
  addActivity: (event: string, data: Record<string, unknown>) => void;
  addTaskLog: (taskId: string, line: unknown) => void;
  getTaskLogs: (taskId: string) => string[];
  clearTaskLogs: (taskId: string) => void;
}

let activityCounter = 0;

export const useEventsStore = create<EventsState>((set, get) => ({
  activities: [],
  taskLogs: new Map(),

  addActivity: (event, data) =>
    set((s) => {
      const activities = [
        {
          id: String(++activityCounter),
          timestamp: new Date().toISOString(),
          event,
          data,
        },
        ...s.activities,
      ].slice(0, 100);
      return { activities };
    }),

  addTaskLog: (taskId, line) =>
    set((s) => {
      const taskLogs = new Map(s.taskLogs);
      const existing = taskLogs.get(taskId) || [];
      const nextLine = typeof line === "string" ? line : String(line ?? "");
      taskLogs.set(taskId, [...existing, nextLine].slice(-500));
      return { taskLogs };
    }),

  getTaskLogs: (taskId) => get().taskLogs.get(taskId) || [],

  clearTaskLogs: (taskId) =>
    set((s) => {
      const taskLogs = new Map(s.taskLogs);
      taskLogs.delete(taskId);
      return { taskLogs };
    }),
}));
