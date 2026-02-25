import {
  GanttChart,
  LayoutGrid,
  List,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

export type TaskViewMode = "list" | "board" | "timeline";

export interface TaskViewOption {
  value: TaskViewMode;
  title: string;
  Icon: LucideIcon;
}

const TASK_VIEW_OPTIONS: readonly TaskViewOption[] = [
  { value: "list", title: "List view", Icon: List },
  { value: "board", title: "Board view", Icon: LayoutGrid },
  { value: "timeline", title: "Timeline view", Icon: GanttChart },
];

export function useTaskViewMode(initialView: TaskViewMode = "list") {
  const [viewMode, setViewMode] = useState<TaskViewMode>(initialView);

  return {
    viewMode,
    setViewMode,
    viewOptions: TASK_VIEW_OPTIONS,
  };
}
