import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsManager } from "@/api/websocket";
import { useDaemonStore } from "@/stores/daemon";
import { useEventsStore } from "@/stores/events";

const BASE_TITLE = "UCM Dashboard";

/**
 * Send a browser notification if the tab is not visible.
 * On first call when permission is "default", requests permission before sending.
 */
function notify(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (!document.hidden) return;

  const send = () => {
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  };

  if (Notification.permission === "granted") {
    send();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") send();
    });
  }
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const setStatus = useDaemonStore((s) => s.setStatus);
  const setConnected = useDaemonStore((s) => s.setConnected);
  const addActivity = useEventsStore((s) => s.addActivity);
  const addTaskLog = useEventsStore((s) => s.addTaskLog);
  const initialized = useRef(false);
  const pendingCount = useRef(0);

  // ---------- Tab title badge ----------
  const updateTitleBadge = useCallback((delta: number) => {
    pendingCount.current = Math.max(0, pendingCount.current + delta);
    const count = pendingCount.current;
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, []);

  // Reset the badge when the user focuses the tab
  useEffect(() => {
    const onFocus = () => {
      pendingCount.current = 0;
      document.title = BASE_TITLE;
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Request notification permission on mount (non-blocking)
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    wsManager.connect();

    const unsubs: Array<() => void> = [];

    unsubs.push(
      wsManager.on("ws:connected", () => setConnected(true)),
      wsManager.on("ws:disconnected", () => {
        setConnected(false);
        setStatus("offline");
      }),

      // Daemon status
      wsManager.on("daemon:status", (data) => {
        const status = data.status as string;
        if (status === "running" || status === "paused" || status === "offline") {
          setStatus(status);
        }
      }),

      // Task events
      wsManager.on("task:created", (data) => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        addActivity("task:created", data);
      }),
      wsManager.on("task:updated", (data) => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        if (data.taskId) {
          queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
        }
        addActivity("task:updated", data);

        // Notify on task failure
        if (data.status === "failed") {
          const taskLabel = (data.taskId as string) || "unknown";
          notify("Task failed", `Task ${taskLabel} has failed.`);
          updateTitleBadge(1);
        }

        // Notify when task enters review state
        if (data.state === "review" || data.status === "review") {
          const taskLabel = (data.taskId as string) || "unknown";
          notify("Task ready for review", `Task ${taskLabel} is ready for review.`);
          updateTitleBadge(1);
        }
      }),
      wsManager.on("task:deleted", (data) => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        addActivity("task:deleted", data);
      }),
      wsManager.on("task:log", (data) => {
        if (data.taskId && data.line) {
          addTaskLog(data.taskId as string, data.line as string);
        }
      }),

      // Stats events — validate shape before overwriting cache
      wsManager.on("stats:updated", (data) => {
        if (data && typeof data.pid === "number" && typeof data.uptime === "number" && data.resources) {
          queryClient.setQueryData(["stats"], data);
          const daemonStatus = data.daemonStatus as string;
          if (daemonStatus === "running" || daemonStatus === "paused" || daemonStatus === "offline") {
            setStatus(daemonStatus);
          }
        }
      }),

      // Proposal events
      wsManager.on("proposal:created", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        addActivity("proposal:created", data);
      }),
      wsManager.on("proposal:updated", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        addActivity("proposal:updated", data);
      }),

      // Observer events
      wsManager.on("observer:started", (data) => {
        queryClient.invalidateQueries({ queryKey: ["observer-status"] });
        addActivity("observer:started", data);
      }),
      wsManager.on("observer:completed", (data) => {
        queryClient.invalidateQueries({ queryKey: ["observer-status"] });
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        addActivity("observer:completed", data);
      }),

      // Autopilot events
      wsManager.on("autopilot:started", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:started", data);
      }),
      wsManager.on("autopilot:planning", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:planning", data);
      }),
      wsManager.on("autopilot:planned", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:planned", data);
      }),
      wsManager.on("autopilot:executing", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:executing", data);
      }),
      wsManager.on("autopilot:progress", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
      }),
      wsManager.on("autopilot:awaiting_review", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:awaiting_review", data);
      }),
      wsManager.on("autopilot:paused", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:paused", data);
      }),
      wsManager.on("autopilot:resumed", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:resumed", data);
      }),
      wsManager.on("autopilot:stopped", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:stopped", data);
      }),
      wsManager.on("autopilot:released", (data) => {
        queryClient.invalidateQueries({ queryKey: ["autopilot"] });
        addActivity("autopilot:released", data);
      }),

      // Refinement events
      wsManager.on("refinement:question", (data) => {
        addActivity("refinement:question", data);
      }),

      // Stage events
      wsManager.on("stage:started", (data) => {
        addActivity("stage:started", data);
      }),
      wsManager.on("stage:complete", (data) => {
        addActivity("stage:complete", data);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }),

      // Config events
      wsManager.on("config:updated", (data) => {
        queryClient.invalidateQueries({ queryKey: ["config"] });
        addActivity("config:updated", data);
      }),

      // Stage gate events
      wsManager.on("stage:gate", (data) => {
        if (data.taskId) {
          queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
        }
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        addActivity("stage:gate", data);

        // Notify on stage gate awaiting approval
        const taskLabel = (data.taskId as string) || "unknown";
        const stageName = (data.stage as string) || (data.stageName as string) || "unknown";
        notify("Stage awaiting approval", `Task ${taskLabel} is waiting for approval at stage "${stageName}".`);
        updateTitleBadge(1);
      }),
      wsManager.on("stage:gate_resolved", (data) => {
        if (data.taskId) {
          queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
        }
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        addActivity("stage:gate_resolved", data);

        // A gate was resolved, decrement the pending badge
        updateTitleBadge(-1);
      }),

      // Pipeline error events
      wsManager.on("pipeline:error", (data) => {
        const taskLabel = (data.taskId as string) || "unknown";
        notify("Task failed", `Task ${taskLabel} encountered a pipeline error.`);
        updateTitleBadge(1);
        addActivity("pipeline:error", data);
      }),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
      wsManager.disconnect();
      initialized.current = false;
    };
  }, [queryClient, setStatus, setConnected, addActivity, addTaskLog, updateTitleBadge]);
}
