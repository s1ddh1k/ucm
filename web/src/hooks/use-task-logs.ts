import { useEffect } from "react";
import { wsManager } from "@/api/websocket";
import { useEventsStore } from "@/stores/events";

export function useTaskLogs(taskId: string | null) {
  const logs = useEventsStore((s) => (taskId ? s.getTaskLogs(taskId) : []));
  const addTaskLog = useEventsStore((s) => s.addTaskLog);

  useEffect(() => {
    if (!taskId) return;

    const unsub = wsManager.on("task:log", (data) => {
      if (data.taskId === taskId && data.line != null) {
        addTaskLog(taskId, data.line);
      }
    });

    return unsub;
  }, [taskId, addTaskLog]);

  return logs;
}
