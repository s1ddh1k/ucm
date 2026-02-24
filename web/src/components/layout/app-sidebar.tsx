import {
  BarChart3,
  FolderTree,
  LayoutDashboard,
  PanelLeft,
  PanelLeftClose,
  Settings,
  Terminal,
} from "lucide-react";
import { useMemo } from "react";
import { NavLink } from "react-router";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProposalsQuery } from "@/queries/proposals";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";

interface BadgeInfo {
  count: number;
  color: string;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: FolderTree, label: "Projects" },
  { to: "/terminal", icon: Terminal, label: "Terminal" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
];

const bottomItems = [{ to: "/settings", icon: Settings, label: "Settings" }];

function useAttentionBadges(): Record<string, BadgeInfo> {
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  return useMemo(() => {
    const badges: Record<string, BadgeInfo> = {};

    const reviewCount = Array.isArray(tasks)
      ? tasks.filter((t) => t.state === "review").length
      : 0;
    const proposedCount = Array.isArray(proposals)
      ? proposals.filter((p) => p.status === "proposed").length
      : 0;
    const total = reviewCount + proposedCount;

    if (total > 0) {
      badges["/"] = { count: total, color: "bg-purple-500" };
    }

    return badges;
  }, [tasks, proposals]);
}

export function AppSidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const badges = useAttentionBadges();

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-4 gap-2">
        <div className="flex h-8 w-8 items-center justify-center shrink-0">
          <svg
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8"
          >
            <rect x="0" y="0" width="64" height="64" rx="14" fill="#0a0a0f" />
            <path
              d="M32 8L55 20.5V45.5L32 58L9 45.5V20.5L32 8Z"
              stroke="#3b82f6"
              strokeWidth="2.5"
              fill="none"
            />
            <circle cx="32" cy="10" r="4" fill="#60a5fa" />
            <circle cx="53" cy="44" r="4" fill="#60a5fa" />
            <circle cx="11" cy="44" r="4" fill="#60a5fa" />
            <line
              x1="32"
              y1="10"
              x2="53"
              y2="44"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />
            <line
              x1="53"
              y1="44"
              x2="11"
              y2="44"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />
            <line
              x1="11"
              y1="44"
              x2="32"
              y2="10"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeOpacity="0.4"
            />
            <circle cx="32" cy="33" r="3" fill="#93c5fd" />
          </svg>
        </div>
        {!collapsed && (
          <span className="font-semibold text-foreground">UCM</span>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Nav Items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => (
          <SidebarNavLink
            key={item.to}
            {...item}
            collapsed={collapsed}
            badge={badges[item.to]}
          />
        ))}
      </nav>

      <Separator className="bg-sidebar-border" />

      {/* Bottom Items */}
      <div className="px-2 py-4 space-y-1">
        {bottomItems.map((item) => (
          <SidebarNavLink key={item.to} {...item} collapsed={collapsed} />
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className={cn(
            "w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
          {!collapsed && <span className="ml-2">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}

function SidebarNavLink({
  to,
  icon: Icon,
  label,
  collapsed,
  badge,
}: {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  collapsed: boolean;
  badge?: BadgeInfo;
}) {
  const link = (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground",
          collapsed && "justify-center px-0",
        )
      }
    >
      {collapsed ? (
        <span className="relative">
          <Icon className="h-4 w-4 shrink-0" />
          {badge && (
            <span
              className={cn(
                "absolute -top-1 -right-1 h-2 w-2 rounded-full",
                badge.color,
              )}
            />
          )}
        </span>
      ) : (
        <>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1">{label}</span>
          {badge && (
            <span
              className={cn(
                "min-w-5 h-5 rounded-full text-white text-[10px] font-medium flex items-center justify-center px-1",
                badge.color,
              )}
            >
              {badge.count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">
          {label}
          {badge && (
            <span
              className={cn(
                "ml-2 inline-flex min-w-4 h-4 rounded-full text-white text-[10px] font-medium items-center justify-center px-1",
                badge.color,
              )}
            >
              {badge.count}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
