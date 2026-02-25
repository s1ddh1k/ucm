import { useMemo } from "react";
import type { Task } from "@/api/types";
import { useQueryFeedback } from "@/hooks/use-query-feedback";
import { getProjectKey, getTaskProjectPath } from "@/lib/project";
import { useTasksQuery } from "@/queries/tasks";

interface UseTaskBoardDataOptions {
  paused?: boolean;
  projectFilter?: string;
}

interface TaskBoardData {
  tasks: Task[] | undefined;
  boardTasks: Task[];
  isLoading: boolean;
  isError: boolean;
  boardError: string;
  isRetrying: boolean;
  retryLabel: string;
  retry: () => void;
}

export function useTaskBoardData(
  options: UseTaskBoardDataOptions = {},
): TaskBoardData {
  const { paused = false, projectFilter = "" } = options;
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useTasksQuery(undefined, paused);

  const boardTasks = useMemo(() => {
    if (!tasks) return [];
    if (!projectFilter) return tasks;
    return tasks.filter(
      (task) => getProjectKey(getTaskProjectPath(task)) === projectFilter,
    );
  }, [tasks, projectFilter]);

  const {
    errorMessage: boardError,
    isRetrying,
    retryLabel,
    retry,
  } = useQueryFeedback(
    { error, isRefetching, refetch },
    {
      fallbackDetail: "Task request failed",
      nextStep: "Check daemon connection, then retry.",
    },
  );

  return {
    tasks,
    boardTasks,
    isLoading,
    isError,
    boardError,
    isRetrying,
    retryLabel,
    retry,
  };
}
