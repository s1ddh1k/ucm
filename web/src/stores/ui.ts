import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  selectedTaskId: string | null;
  selectedSessionId: string | null;
  commandPaletteOpen: boolean;
  taskFilter: string;
  taskSort: "created" | "priority" | "title";
  taskSearch: string;
  proposalFilter: string;
  proposalCategoryFilter: string;
  proposalRiskFilter: string;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedTaskId: (id: string | null) => void;
  setSelectedSessionId: (id: string | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTaskFilter: (filter: string) => void;
  setTaskSort: (sort: UiState["taskSort"]) => void;
  setTaskSearch: (search: string) => void;
  setProposalFilter: (filter: string) => void;
  setProposalCategoryFilter: (filter: string) => void;
  setProposalRiskFilter: (filter: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  selectedTaskId: null,
  selectedSessionId: null,
  commandPaletteOpen: false,
  taskFilter: "",
  taskSort: "created",
  taskSearch: "",
  proposalFilter: "",
  proposalCategoryFilter: "",
  proposalRiskFilter: "",
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setTaskFilter: (filter) => set({ taskFilter: filter }),
  setTaskSort: (sort) => set({ taskSort: sort }),
  setTaskSearch: (search) => set({ taskSearch: search }),
  setProposalFilter: (filter) => set({ proposalFilter: filter }),
  setProposalCategoryFilter: (filter) => set({ proposalCategoryFilter: filter }),
  setProposalRiskFilter: (filter) => set({ proposalRiskFilter: filter }),
}));
