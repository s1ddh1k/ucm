import { useMemo, useRef } from "react";
import { useUiStore } from "@/stores/ui";
import { getTaskProjectLabel } from "@/lib/project";
import type { Task } from "@/api/types";

const STATE_COLORS: Record<string, string> = {
  pending: "bg-yellow-400/70",
  running: "bg-blue-400/70",
  review: "bg-purple-400/70",
  done: "bg-emerald-400/70",
  failed: "bg-red-400/70",
};

interface TaskTimelineProps {
  tasks: Task[];
}

export function TaskTimeline({ tasks }: TaskTimelineProps) {
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter tasks with time data and compute layout
  const { timelineTasks, groups, timeRange, hourMarkers } = useMemo(() => {
    // Only include tasks that have startedAt
    const withTime = tasks.filter(t => t.startedAt).map(t => {
      const start = new Date(t.startedAt!).getTime();
      const end = t.completedAt ? new Date(t.completedAt).getTime() : Date.now();
      return { ...t, startMs: start, endMs: end };
    });

    if (withTime.length === 0) {
      return { timelineTasks: [], groups: [], timeRange: { min: 0, max: 0, span: 0 }, hourMarkers: [] };
    }

    // Time range
    const allStarts = withTime.map(t => t.startMs);
    const allEnds = withTime.map(t => t.endMs);
    const min = Math.min(...allStarts);
    const max = Math.max(...allEnds);
    const span = max - min || 1; // avoid division by zero

    // Group by project
    const groupMap = new Map<string, typeof withTime>();
    for (const t of withTime) {
      const project = getTaskProjectLabel(t);
      if (!groupMap.has(project)) groupMap.set(project, []);
      groupMap.get(project)!.push(t);
    }

    // Sort within each group by start time
    const groups = [...groupMap.entries()].map(([project, tasks]) => ({
      project,
      tasks: tasks.sort((a, b) => a.startMs - b.startMs),
    }));

    // Hour markers
    const markers: { time: number; label: string }[] = [];
    const hourMs = 3600_000;
    const spanHours = span / hourMs;
    // Choose interval: if < 24 hours, show every hour; if < 7 days, show every 6 hours; else show every day
    let intervalMs: number;
    if (spanHours <= 24) intervalMs = hourMs;
    else if (spanHours <= 168) intervalMs = hourMs * 6;
    else intervalMs = hourMs * 24;

    const firstMarker = Math.ceil(min / intervalMs) * intervalMs;
    for (let t = firstMarker; t <= max; t += intervalMs) {
      const d = new Date(t);
      const label = intervalMs >= hourMs * 24
        ? `${d.getMonth() + 1}/${d.getDate()}`
        : `${d.getHours().toString().padStart(2, "0")}:00`;
      markers.push({ time: t, label });
    }

    return {
      timelineTasks: withTime,
      groups,
      timeRange: { min, max, span },
      hourMarkers: markers,
    };
  }, [tasks]);

  if (timelineTasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No tasks with timing data
      </div>
    );
  }

  const ROW_HEIGHT = 32;
  const LEFT_GUTTER = 160; // project label width

  function getLeft(startMs: number): number {
    return ((startMs - timeRange.min) / timeRange.span) * 100;
  }

  function getWidth(startMs: number, endMs: number): number {
    return Math.max(((endMs - startMs) / timeRange.span) * 100, 0.5); // min 0.5% width
  }

  return (
    <div ref={containerRef} className="h-full overflow-auto">
      {/* Time axis header */}
      <div className="sticky top-0 z-10 bg-background border-b flex" style={{ height: 28 }}>
        <div className="shrink-0" style={{ width: LEFT_GUTTER }} />
        <div className="flex-1 relative">
          {hourMarkers.map((m, i) => (
            <span
              key={i}
              className="absolute text-[10px] text-muted-foreground -translate-x-1/2"
              style={{ left: `${getLeft(m.time)}%`, top: 8 }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>

      {/* Groups */}
      {groups.map((group) => (
        <div key={group.project}>
          {/* Group header */}
          <div className="flex items-center sticky top-7 bg-muted/50 z-[5] border-b">
            <div className="text-xs font-medium text-muted-foreground px-3 py-1 truncate" style={{ width: LEFT_GUTTER }}>
              {group.project}
            </div>
          </div>

          {/* Task rows */}
          {group.tasks.map((task) => (
            <div key={task.id} className="flex items-center border-b border-border/30" style={{ height: ROW_HEIGHT }}>
              {/* Task label */}
              <div
                className="text-xs truncate px-3 shrink-0 text-muted-foreground hover:text-foreground cursor-pointer"
                style={{ width: LEFT_GUTTER }}
                onClick={() => setSelectedTaskId(task.id)}
                title={task.title}
              >
                {task.title}
              </div>

              {/* Bar */}
              <div className="flex-1 relative h-full">
                {/* Grid lines */}
                {hourMarkers.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/20"
                    style={{ left: `${getLeft(m.time)}%` }}
                  />
                ))}

                {/* Task bar */}
                <div
                  className={`absolute top-1.5 rounded cursor-pointer transition-opacity hover:opacity-80 ${
                    STATE_COLORS[task.state] || "bg-muted"
                  } ${selectedTaskId === task.id ? "ring-1 ring-primary" : ""}`}
                  style={{
                    left: `${getLeft(task.startMs)}%`,
                    width: `${getWidth(task.startMs, task.endMs)}%`,
                    height: ROW_HEIGHT - 12,
                  }}
                  onClick={() => setSelectedTaskId(task.id)}
                  title={`${task.title}\n${task.state}\n${new Date(task.startMs).toLocaleString()} → ${task.completedAt ? new Date(task.endMs).toLocaleString() : "running"}`}
                >
                  {getWidth(task.startMs, task.endMs) > 8 && (
                    <span className="text-[9px] text-white px-1.5 truncate block leading-5">
                      {task.title}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Legend */}
      <div className="sticky bottom-0 bg-background border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
        {Object.entries(STATE_COLORS).map(([state, color]) => (
          <span key={state} className="flex items-center gap-1">
            <span className={`w-3 h-2 rounded ${color}`} />
            <span className="capitalize">{state}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
