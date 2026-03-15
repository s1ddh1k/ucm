import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeUpdateEvent, UcmDesktopApi } from "../shared/contracts";

const api: UcmDesktopApi = {
  app: {
    getVersion: () => ipcRenderer.invoke("app:get-version"),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    setActive: (input) => ipcRenderer.invoke("workspace:set-active", input),
    add: (input) => ipcRenderer.invoke("workspace:add", input),
    browse: (input) => ipcRenderer.invoke("workspace:browse", input),
    createDirectory: (input) =>
      ipcRenderer.invoke("workspace:create-directory", input),
  },
  mission: {
    list: () => ipcRenderer.invoke("mission:list"),
    getActive: () => ipcRenderer.invoke("mission:get-active"),
    setActive: (input) => ipcRenderer.invoke("mission:set-active", input),
    create: (input) => ipcRenderer.invoke("mission:create", input),
  },
  run: {
    getActive: () => ipcRenderer.invoke("run:get-active"),
    listForActiveMission: () => ipcRenderer.invoke("run:list-for-active-mission"),
    setActive: (input) => ipcRenderer.invoke("run:set-active", input),
    retry: (input) => ipcRenderer.invoke("run:retry", input),
    autopilotStep: () => ipcRenderer.invoke("run:autopilot-step"),
    autopilotBurst: (input) => ipcRenderer.invoke("run:autopilot-burst", input),
    steeringSubmit: (input) => ipcRenderer.invoke("run:steering-submit", input),
    terminalWrite: (input) => ipcRenderer.invoke("run:terminal-write", input),
    terminalResize: (input) =>
      ipcRenderer.invoke("run:terminal-resize", input),
    terminalKill: (input) => ipcRenderer.invoke("run:terminal-kill", input),
  },
  release: {
    generate: (input) => ipcRenderer.invoke("release:generate", input),
    handoff: (input) => ipcRenderer.invoke("release:handoff", input),
    approve: (input) => ipcRenderer.invoke("release:approve", input),
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
