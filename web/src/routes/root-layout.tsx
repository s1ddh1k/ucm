import { useEffect } from "react";
import { Outlet } from "react-router";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Header } from "@/components/layout/header";
import { useWebSocket } from "@/hooks/use-websocket";
import { useStatsQuery } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";

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

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
