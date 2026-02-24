import { useCallback, useMemo, useState } from "react";
import type { Task } from "@/api/types";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getTaskProjectLabel } from "@/lib/project";
import { useUpdatePriority } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";

const COLUMNS = [
  {
    state: "pending",
    label: "Pending",
    color: "border-yellow-400/30",
    headerColor: "text-yellow-400",
  },
  {
    state: "running",
    label: "Running",
    color: "border-blue-400/30",
    headerColor: "text-blue-400",
  },
  {
    state: "review",
    label: "Review",
    color: "border-purple-400/30",
    headerColor: "text-purple-400",
  },
  {
    state: "done",
    label: "Done",
    color: "border-emerald-400/30",
    headerColor: "text-emerald-400",
  },
  {
    state: "failed",
    label: "Failed",
    color: "border-red-400/30",
    headerColor: "text-red-400",
  },
] as const;

interface TaskKanbanProps {
  tasks: Task[];
}

export function TaskKanban({ tasks }: TaskKanbanProps) {
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const updatePriority = useUpdatePriority();
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);

  const columns = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of COLUMNS) map[col.state] = [];
    for (const task of tasks) {
      if (map[task.state]) map[task.state].push(task);
    }
    // Sort pending by priority (highest first)
    map.pending.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    // Sort others by most recent first
    for (const state of ["running", "review", "done", "failed"]) {
      map[state].sort(
        (a, b) =>
          new Date(b.startedAt || b.created).getTime() -
          new Date(a.startedAt || a.created).getTime(),
      );
    }
    return map;
  }, [tasks]);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
    setDragTaskId(taskId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, state: string) => {
    // Only allow drop in pending column
    if (state !== "pending") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(state);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetState: string, targetIndex: number) => {
      e.preventDefault();
      setDragOverColumn(null);
      setDragTaskId(null);
      if (targetState !== "pending") return;

      const taskId = e.dataTransfer.getData("text/plain");
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.state !== "pending") return;

      // Calculate new priority based on position
      const pendingTasks = columns.pending;
      let newPriority: number;
      if (targetIndex === 0) {
        newPriority = (pendingTasks[0]?.priority || 0) + 1;
      } else if (targetIndex >= pendingTasks.length) {
        newPriority =
          (pendingTasks[pendingTasks.length - 1]?.priority || 0) - 1;
      } else {
        const above = pendingTasks[targetIndex - 1]?.priority || 0;
        const below = pendingTasks[targetIndex]?.priority || 0;
        newPriority = Math.round((above + below) / 2);
      }

      updatePriority.mutate({ taskId, priority: newPriority });
    },
    [tasks, columns.pending, updatePriority],
  );

  return (
    <div className="flex gap-3 h-full overflow-x-auto p-3">
      {COLUMNS.map((col) => {
        const colTasks = columns[col.state] || [];
        return (
          <div
            key={col.state}
            className={`flex flex-col w-60 shrink-0 rounded-lg border ${col.color} ${
              dragOverColumn === col.state ? "bg-accent/30" : "bg-muted/20"
            }`}
            onDragOver={(e) => handleDragOver(e, col.state)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.state, colTasks.length)}
          >
            {/* Column Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className={`text-xs font-medium ${col.headerColor}`}>
                {col.label}
              </span>
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                {colTasks.length}
              </Badge>
            </div>

            {/* Cards */}
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {colTasks.map((task, i) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    isSelected={selectedTaskId === task.id}
                    isDragging={dragTaskId === task.id}
                    draggable={col.state === "pending"}
                    onSelect={() => setSelectedTaskId(task.id)}
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDrop={(e) => handleDrop(e, col.state, i)}
                  />
                ))}
                {colTasks.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-4">
                    Empty
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  task,
  isSelected,
  isDragging,
  draggable,
  onSelect,
  onDragStart,
  onDrop,
}: {
  task: Task;
  isSelected: boolean;
  isDragging: boolean;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const projectLabel = getTaskProjectLabel(task);
  return (
    <Card
      className={`p-2.5 cursor-pointer transition-all text-xs ${
        isSelected ? "ring-1 ring-primary" : "hover:bg-accent/50"
      } ${isDragging ? "opacity-50" : ""} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onClick={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (draggable) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop(e);
      }}
    >
      <p className="font-medium truncate mb-1">{task.title}</p>
      <div className="flex items-center justify-between gap-1 text-muted-foreground">
        <span className="truncate">{projectLabel}</span>
        <TimeAgo date={task.created} className="text-[10px] shrink-0" />
      </div>
      {task.currentStage && task.state === "running" && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-blue-400 text-[10px]">{task.currentStage}</span>
        </div>
      )}
      {task.stageGate && task.state === "running" && (
        <div className="mt-1.5 flex items-center gap-1">
          <span className="text-amber-400 text-[10px]">
            {"⏸"} {task.stageGate}
          </span>
        </div>
      )}
    </Card>
  );
}
