import { useLocation } from "react-router";
import { ConnectionIndicator } from "@/components/shared/connection-indicator";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/tasks": "Task Inbox",
  "/proposals": "Proposal Inbox",
  "/autopilot": "Autopilot",
  "/terminal": "Terminal",
  "/settings": "Settings",
};

export function Header() {
  const location = useLocation();
  const title = (() => {
    if (location.pathname.startsWith("/projects/") && location.pathname.split("/").length === 3) {
      return "Project Overview";
    }
    if (location.pathname.startsWith("/projects/") && location.pathname.endsWith("/tasks")) {
      return "Project Tasks";
    }
    if (location.pathname.startsWith("/projects/") && location.pathname.endsWith("/proposals")) {
      return "Project Proposals";
    }
    return pageTitles[location.pathname] || "UCM";
  })();

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <ConnectionIndicator />
    </header>
  );
}
