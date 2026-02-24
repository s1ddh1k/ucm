import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface UiState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  sidebarCollapsed: boolean;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  commandPaletteOpen: boolean;
  activeProjectKey: string;
  activeProjectLabel: string;
  activeProjectPath: string;
  taskFilter: string;
  taskProjectFilter: string;
  taskSort: "created" | "priority" | "title";
  taskSearch: string;
  proposalFilter: string;
  proposalProjectFilter: string;
  proposalCategoryFilter: string;
  proposalRiskFilter: string;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  setSelectedSessionId: (id: string | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setActiveProject: (project: { key: string; label: string; path?: string | null } | null) => void;
  clearActiveProject: () => void;
  setTaskFilter: (filter: string) => void;
  setTaskProjectFilter: (filter: string) => void;
  setTaskSort: (sort: UiState["taskSort"]) => void;
  setTaskSearch: (search: string) => void;
  setProposalFilter: (filter: string) => void;
  setProposalProjectFilter: (filter: string) => void;
  setProposalCategoryFilter: (filter: string) => void;
  setProposalRiskFilter: (filter: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: (localStorage.getItem("ucm-theme") as Theme) || "light",
  setTheme: (theme) => {
    localStorage.setItem("ucm-theme", theme);
    applyTheme(theme);
    set({ theme });
  },
  sidebarCollapsed: false,
  selectedTaskId: null,
  selectedSessionId: null,
  commandPaletteOpen: false,
  activeProjectKey: "",
  activeProjectLabel: "",
  activeProjectPath: "",
  taskFilter: "",
  taskProjectFilter: "",
  taskSort: "created",
  taskSearch: "",
  proposalFilter: "",
  proposalProjectFilter: "",
  proposalCategoryFilter: "",
  proposalRiskFilter: "",
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setActiveProject: (project) =>
    set({
      activeProjectKey: project?.key || "",
      activeProjectLabel: project?.label || "",
      activeProjectPath: project?.path || "",
    }),
  clearActiveProject: () => set({ activeProjectKey: "", activeProjectLabel: "", activeProjectPath: "" }),
  setTaskFilter: (filter) => set({ taskFilter: filter }),
  setTaskProjectFilter: (filter) => set({ taskProjectFilter: filter }),
  setTaskSort: (sort) => set({ taskSort: sort }),
  setTaskSearch: (search) => set({ taskSearch: search }),
  setProposalFilter: (filter) => set({ proposalFilter: filter }),
  setProposalProjectFilter: (filter) => set({ proposalProjectFilter: filter }),
  setProposalCategoryFilter: (filter) => set({ proposalCategoryFilter: filter }),
  setProposalRiskFilter: (filter) => set({ proposalRiskFilter: filter }),
}));
