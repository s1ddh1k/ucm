import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import AnalyticsPage from "@/routes/analytics";
import AutopilotPage from "@/routes/autopilot";
import DashboardPage from "@/routes/dashboard";
import ProjectOverviewPage from "@/routes/project-overview";
import ProjectsPage from "@/routes/projects";
import ProposalsPage from "@/routes/proposals";
import RootLayout from "@/routes/root-layout";
import SettingsPage from "@/routes/settings";
import TasksPage from "@/routes/tasks";
import TerminalPage from "@/routes/terminal";

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
                <Route path="projects" element={<ProjectsPage />} />
                <Route
                  path="projects/:projectKey"
                  element={<ProjectOverviewPage />}
                />
                <Route
                  path="projects/:projectKey/tasks"
                  element={<TasksPage />}
                />
                <Route
                  path="projects/:projectKey/proposals"
                  element={<ProposalsPage />}
                />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="proposals" element={<ProposalsPage />} />
                <Route path="autopilot" element={<AutopilotPage />} />
                <Route path="terminal" element={<TerminalPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
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
