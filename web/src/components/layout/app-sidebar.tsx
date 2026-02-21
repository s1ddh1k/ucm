import { NavLink } from "react-router";
import {
  LayoutDashboard, FolderTree, ListTodo, Lightbulb, Bot, Terminal, Settings,
  PanelLeftClose, PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/projects", icon: FolderTree, label: "Projects" },
  { to: "/tasks", icon: ListTodo, label: "Task Inbox" },
  { to: "/proposals", icon: Lightbulb, label: "Proposal Inbox" },
  { to: "/autopilot", icon: Bot, label: "Autopilot" },
  { to: "/terminal", icon: Terminal, label: "Terminal" },
];

const bottomItems = [
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function AppSidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center px-4 gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm shrink-0">
          U
        </div>
        {!collapsed && <span className="font-semibold text-foreground">UCM</span>}
      </div>

      <Separator className="bg-sidebar-border" />

      {/* Nav Items */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => (
          <SidebarNavLink key={item.to} {...item} collapsed={collapsed} />
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
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span className="ml-2">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}

function SidebarNavLink({
  to, icon: Icon, label, collapsed,
}: {
  to: string; icon: typeof LayoutDashboard; label: string; collapsed: boolean;
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
          collapsed && "justify-center px-0"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
