import { useState } from "react";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { useUiStore } from "@/stores/ui";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export default function TasksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);

  return (
    <div className="flex h-full">
      <div className="w-80 shrink-0">
        <TaskList onNewTask={() => setCreateOpen(true)} />
      </div>

      <div className="flex-1 min-w-0">
        {selectedTaskId ? (
          <TaskDetail taskId={selectedTaskId} />
        ) : (
          <EmptyState
            icon={FileText}
            title="Select a task"
            description="Choose a task from the list to view its details"
            className="h-full"
          />
        )}
      </div>

      <TaskCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
