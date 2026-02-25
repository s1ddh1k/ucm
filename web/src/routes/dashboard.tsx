import {
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  ToggleRight,
} from "lucide-react";
import { useSearchParams } from "react-router";
import { AutomationTabContent } from "@/components/automation/automation-tab-content";
import { DashboardOverviewContent } from "@/components/dashboard/dashboard-overview-content";
import { ProposalInboxContent } from "@/components/proposals/proposal-inbox-content";
import { TaskInboxContent } from "@/components/tasks/task-inbox-content";
import { useProposalsQuery } from "@/queries/proposals";
import { useTasksQuery } from "@/queries/tasks";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "proposals", label: "Proposals", icon: Lightbulb },
  { key: "automation", label: "Automation", icon: ToggleRight },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "overview";
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  const reviewCount = tasks?.filter((t) => t.state === "review").length ?? 0;
  const proposedCount =
    proposals?.filter((p) => p.status === "proposed").length ?? 0;

  function getBadge(key: TabKey): number {
    if (key === "tasks") return reviewCount;
    if (key === "proposals") return proposedCount;
    return 0;
  }

  function switchTab(key: TabKey) {
    if (key === "overview") {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab: key }, { replace: true });
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="border-b px-6 flex items-center gap-1">
        {TABS.map(({ key, label, icon: Icon }) => {
          const badge = getBadge(key);
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
              onClick={() => switchTab(key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {badge > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto p-6">
        {activeTab === "overview" && <DashboardOverviewContent />}
        {activeTab === "tasks" && <TaskInboxContent />}
        {activeTab === "proposals" && <ProposalInboxContent />}
        {activeTab === "automation" && <AutomationTabContent />}
      </div>
    </div>
  );
}
