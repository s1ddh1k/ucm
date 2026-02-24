import { Bell, Monitor, Moon, Search, Sun } from "lucide-react";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ConnectionIndicator } from "@/components/shared/connection-indicator";
import { InboxDrawer, useInboxCount } from "@/components/shared/inbox-drawer";
import { Button } from "@/components/ui/button";
import { type Theme, useUiStore } from "@/stores/ui";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/terminal": "Terminal",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

const TAB_TITLES: Record<string, string> = {
  tasks: "Tasks",
  proposals: "Proposals",
  automation: "Automation",
};

const THEME_CYCLE: Theme[] = ["light", "dark", "system"];
const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

export function Header() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [inboxOpen, setInboxOpen] = useState(false);
  const inboxCount = useInboxCount();

  const title = (() => {
    if (
      location.pathname.startsWith("/projects/") &&
      location.pathname.split("/").length === 3
    ) {
      return "Project Overview";
    }
    if (
      location.pathname.startsWith("/projects/") &&
      location.pathname.endsWith("/tasks")
    ) {
      return "Project Tasks";
    }
    if (
      location.pathname.startsWith("/projects/") &&
      location.pathname.endsWith("/proposals")
    ) {
      return "Project Proposals";
    }
    if (location.pathname === "/") {
      const tab = searchParams.get("tab");
      if (tab && TAB_TITLES[tab]) return TAB_TITLES[tab];
    }
    return pageTitles[location.pathname] || "UCM";
  })();

  function cycleTheme() {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  }

  const Icon = THEME_ICON[theme];

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-muted-foreground"
          onClick={() => useUiStore.getState().setCommandPaletteOpen(true)}
        >
          <Search className="h-3.5 w-3.5 mr-1" />
          <kbd className="text-[10px] bg-muted px-1 py-0.5 rounded font-mono">
            ⌘K
          </kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 relative"
          onClick={() => setInboxOpen(true)}
          aria-label="Inbox"
        >
          <Bell className="h-4 w-4" />
          {inboxCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-purple-500 text-white text-[10px] font-medium flex items-center justify-center px-1">
              {inboxCount > 9 ? "9+" : inboxCount}
            </span>
          )}
        </Button>
        <InboxDrawer open={inboxOpen} onOpenChange={setInboxOpen} />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={cycleTheme}
          aria-label={`Theme: ${THEME_LABEL[theme]}`}
          title={`Theme: ${THEME_LABEL[theme]}`}
        >
          <Icon className="h-4 w-4" />
        </Button>
        <ConnectionIndicator />
      </div>
    </header>
  );
}
