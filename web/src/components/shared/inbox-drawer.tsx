import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle,
  Lightbulb,
  Pause,
} from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useProposalsQuery } from "@/queries/proposals";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";
import type { TaskFilter } from "@/stores/ui";
import { TimeAgo } from "./time-ago";

interface InboxDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InboxDrawer({ open, onOpenChange }: InboxDrawerProps) {
  const navigate = useNavigate();
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const setTaskFilter = useUiStore((s) => s.setTaskFilter);
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();
  const reviewTasks = useMemo(
    () => (tasks || []).filter((t) => t.state === "review"),
    [tasks],
  );
  const failedTasks = useMemo(
    () => (tasks || []).filter((t) => t.state === "failed"),
    [tasks],
  );
  const gateTasks = useMemo(
    () => (tasks || []).filter((t) => t.state === "running" && t.stageGate),
    [tasks],
  );
  const pendingProposals = useMemo(
    () => (proposals || []).filter((p) => p.status === "proposed"),
    [proposals],
  );
  const totalCount =
    reviewTasks.length +
    failedTasks.length +
    gateTasks.length +
    pendingProposals.length;

  function goToTask(taskId: string) {
    setSelectedTaskId(taskId);
    setTaskFilter("");
    navigate("/?tab=tasks");
    onOpenChange(false);
  }

  function goToTasks(filter: TaskFilter) {
    setTaskFilter(filter);
    navigate("/?tab=tasks");
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Inbox
            {totalCount > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalCount}
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CheckCircle className="h-8 w-8 text-emerald-400 mb-3" />
              <p className="text-sm font-medium">All clear</p>
              <p className="text-xs text-muted-foreground mt-1">
                Nothing needs your attention
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {/* Review Tasks */}
              {reviewTasks.length > 0 && (
                <InboxSection
                  title="Tasks in Review"
                  count={reviewTasks.length}
                  icon={<CheckCircle className="h-3.5 w-3.5 text-purple-400" />}
                  onViewAll={() => goToTasks("review")}
                >
                  {reviewTasks.map((task) => (
                    <InboxItem
                      key={task.id}
                      title={task.title}
                      subtitle={<TimeAgo date={task.created} />}
                      onClick={() => goToTask(task.id)}
                    />
                  ))}
                </InboxSection>
              )}

              {/* Stage Gates */}
              {gateTasks.length > 0 && (
                <InboxSection
                  title="Stage Approval Needed"
                  count={gateTasks.length}
                  icon={<Pause className="h-3.5 w-3.5 text-amber-400" />}
                >
                  {gateTasks.map((task) => (
                    <InboxItem
                      key={task.id}
                      title={task.title}
                      subtitle={
                        <span className="text-amber-400">
                          {task.stageGate} stage
                        </span>
                      }
                      onClick={() => goToTask(task.id)}
                    />
                  ))}
                </InboxSection>
              )}

              {/* Failed Tasks */}
              {failedTasks.length > 0 && (
                <InboxSection
                  title="Failed Tasks"
                  count={failedTasks.length}
                  icon={<AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
                  onViewAll={() => goToTasks("failed")}
                >
                  {failedTasks.map((task) => (
                    <InboxItem
                      key={task.id}
                      title={task.title}
                      subtitle={
                        <TimeAgo date={task.completedAt || task.created} />
                      }
                      onClick={() => goToTask(task.id)}
                    />
                  ))}
                </InboxSection>
              )}

              {/* Pending Proposals */}
              {pendingProposals.length > 0 && (
                <InboxSection
                  title="Pending Proposals"
                  count={pendingProposals.length}
                  icon={<Lightbulb className="h-3.5 w-3.5 text-amber-400" />}
                  onViewAll={() => {
                    navigate("/?tab=proposals");
                    onOpenChange(false);
                  }}
                >
                  {pendingProposals.slice(0, 5).map((p) => (
                    <InboxItem
                      key={p.id}
                      title={p.title}
                      subtitle={
                        <span>
                          {p.category} · {p.risk} risk
                        </span>
                      }
                      onClick={() => {
                        navigate("/?tab=proposals");
                        onOpenChange(false);
                      }}
                    />
                  ))}
                  {pendingProposals.length > 5 && (
                    <p className="px-4 py-1.5 text-xs text-muted-foreground">
                      +{pendingProposals.length - 5} more
                    </p>
                  )}
                </InboxSection>
              )}

            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function InboxSection({
  title,
  count,
  icon,
  onViewAll,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between px-4 py-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium">{title}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {count}
          </Badge>
        </div>
        {onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={onViewAll}
          >
            View all <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function InboxItem({
  title,
  subtitle,
  onClick,
}: {
  title: string;
  subtitle: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-4 py-2 hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <p className="text-sm truncate">{title}</p>
      <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
    </button>
  );
}

// Export badge count hook for use in header
export function useInboxCount() {
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  return useMemo(() => {
    const reviewTasks = (tasks || []).filter(
      (t) => t.state === "review",
    ).length;
    const failedTasks = (tasks || []).filter(
      (t) => t.state === "failed",
    ).length;
    const gateTasks = (tasks || []).filter(
      (t) => t.state === "running" && t.stageGate,
    ).length;
    const pendingProposals = (proposals || []).filter(
      (p) => p.status === "proposed",
    ).length;
    return (
      reviewTasks +
      failedTasks +
      gateTasks +
      pendingProposals
    );
  }, [tasks, proposals]);
}
