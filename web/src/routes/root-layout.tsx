import { useEffect } from "react";
import { Outlet } from "react-router";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { CommandPalette } from "@/components/shared/command-palette";
import { useWebSocket } from "@/hooks/use-websocket";
import { useStatsQuery } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";
import { useUiStore } from "@/stores/ui";

export default function RootLayout() {
  useWebSocket();

  // Sync daemon status from stats HTTP query (covers initial load before WS events)
  const { data: stats } = useStatsQuery();
  const setStatus = useDaemonStore((s) => s.setStatus);
  useEffect(() => {
    if (stats?.daemonStatus) {
      setStatus(stats.daemonStatus);
    }
  }, [stats?.daemonStatus, setStatus]);

  // Apply theme on mount and listen for system preference changes
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  useEffect(() => {
    // Apply stored theme
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.classList.toggle("dark", resolved === "dark");

    // Listen for system preference changes when in "system" mode
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, setTheme]);

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
