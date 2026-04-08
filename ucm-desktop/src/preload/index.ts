import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeUpdateEvent, UcmDesktopApi } from "../shared/contracts";

const api: UcmDesktopApi = {
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  navigation: {
    listScreens: () => ipcRenderer.invoke("navigation:list-screens"),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    setActive: (input: { workspaceId: string }) => ipcRenderer.invoke("workspace:set-active", input),
    add: (input: { rootPath: string }) => ipcRenderer.invoke("workspace:add", input),
    pickDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
    browse: (input?: { rootPath?: string }) => ipcRenderer.invoke("workspace:browse", input),
    createDirectory: (input: { parentPath: string; directoryName: string }) =>
      ipcRenderer.invoke("workspace:create-directory", input),
  },
  mission: {
    list: () => ipcRenderer.invoke("mission:list"),
    getActive: () => ipcRenderer.invoke("mission:get-active"),
    setActive: (input: { missionId: string }) => ipcRenderer.invoke("mission:set-active", input),
    create: (input: { workspaceId: string; title: string; goal: string; command?: string }) =>
      ipcRenderer.invoke("mission:create", input),
  },
  run: {
    getActive: () => ipcRenderer.invoke("run:get-active"),
    listForActiveMission: () => ipcRenderer.invoke("run:list-for-active-mission"),
    listWakeupRequests: (input: { runId: string }) =>
      ipcRenderer.invoke("run:list-wakeup-requests", input),
    listExecutionAttempts: (input: { runId: string }) =>
      ipcRenderer.invoke("run:list-execution-attempts", input),
    listSessionLeases: (input: { runId: string }) =>
      ipcRenderer.invoke("run:list-session-leases", input),
    setActive: (input: { runId: string }) => ipcRenderer.invoke("run:set-active", input),
    retry: (input: { runId: string }) => ipcRenderer.invoke("run:retry", input),
    autopilotStep: () => ipcRenderer.invoke("run:autopilot-step"),
    autopilotBurst: (input?: { maxSteps?: number }) => ipcRenderer.invoke("run:autopilot-burst", input),
    steeringSubmit: (input: { runId: string; text: string }) => ipcRenderer.invoke("run:steering-submit", input),
    terminalWrite: (input: { sessionId: string; data: string }) => ipcRenderer.invoke("run:terminal-write", input),
    terminalResize: (input: { sessionId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke("run:terminal-resize", input),
    terminalKill: (input: { sessionId: string }) => ipcRenderer.invoke("run:terminal-kill", input),
  },
  deliverable: {
    generate: (input: { runId: string; deliverableId: string; summary: string }) =>
      ipcRenderer.invoke("release:generate", input),
    handoff: (input: { runId: string; deliverableRevisionId: string; channel: string; target?: string }) =>
      ipcRenderer.invoke("release:handoff", input),
    approve: (input: { runId: string; deliverableRevisionId: string }) =>
      ipcRenderer.invoke("release:approve", input),
  },
  shell: {
    getSnapshot: () => ipcRenderer.invoke("shell:get-snapshot"),
  },
  events: {
    onRuntimeUpdate: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: RuntimeUpdateEvent,
      ) => {
        listener(payload);
      };
      ipcRenderer.on("runtime:updated", handler);
      return () => {
        ipcRenderer.removeListener("runtime:updated", handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("ucm", api);
