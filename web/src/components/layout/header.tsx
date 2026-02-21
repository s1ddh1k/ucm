import { useLocation } from "react-router";
import { ConnectionIndicator } from "@/components/shared/connection-indicator";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/tasks": "Tasks",
  "/proposals": "Proposals",
  "/autopilot": "Autopilot",
  "/terminal": "Terminal",
  "/settings": "Settings",
};

export function Header() {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "UCM";

  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <ConnectionIndicator />
    </header>
  );
}
