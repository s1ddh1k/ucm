import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import RootLayout from "@/routes/root-layout";
import DashboardPage from "@/routes/dashboard";
import TasksPage from "@/routes/tasks";
import ProposalsPage from "@/routes/proposals";
import AutopilotPage from "@/routes/autopilot";
import TerminalPage from "@/routes/terminal";
import SettingsPage from "@/routes/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ErrorBoundary>
          <BrowserRouter>
            <Routes>
              <Route element={<RootLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="proposals" element={<ProposalsPage />} />
                <Route path="autopilot" element={<AutopilotPage />} />
                <Route path="terminal" element={<TerminalPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            className: "border border-border bg-card text-card-foreground",
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
