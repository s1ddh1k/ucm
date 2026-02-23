import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui";
import { useTasksQuery } from "@/queries/tasks";
import { useProposalsQuery } from "@/queries/proposals";
import {
  LayoutDashboard,
  FolderTree,
  ListTodo,
  Lightbulb,
  Bot,
  Terminal,
  Settings,
  Search,
  FileText,
  ArrowRight,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  category: "page" | "task" | "proposal" | "action";
  icon?: React.ElementType;
  onSelect: () => void;
}

const CATEGORY_ORDER = ["page", "action", "task", "proposal"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  page: "Pages",
  action: "Actions",
  task: "Tasks",
  proposal: "Proposals",
};

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!open);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, setOpen]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Build the full list of command items
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      // Pages
      {
        id: "page-dashboard",
        label: "Dashboard",
        category: "page",
        icon: LayoutDashboard,
        onSelect: () => navigate("/"),
      },
      {
        id: "page-projects",
        label: "Projects",
        category: "page",
        icon: FolderTree,
        onSelect: () => navigate("/projects"),
      },
      {
        id: "page-tasks",
        label: "Task Inbox",
        category: "page",
        icon: ListTodo,
        onSelect: () => navigate("/tasks"),
      },
      {
        id: "page-proposals",
        label: "Proposal Inbox",
        category: "page",
        icon: Lightbulb,
        onSelect: () => navigate("/proposals"),
      },
      {
        id: "page-autopilot",
        label: "Autopilot",
        category: "page",
        icon: Bot,
        onSelect: () => navigate("/autopilot"),
      },
      {
        id: "page-terminal",
        label: "Terminal",
        category: "page",
        icon: Terminal,
        onSelect: () => navigate("/terminal"),
      },
      {
        id: "page-settings",
        label: "Settings",
        category: "page",
        icon: Settings,
        onSelect: () => navigate("/settings"),
      },
      // Actions
      {
        id: "action-new-task",
        label: "New Task",
        category: "action",
        icon: ListTodo,
        onSelect: () => navigate("/tasks?new=1"),
      },
    ];

    // Tasks (limit to 20 most recent for performance)
    if (tasks) {
      const recent = [...tasks]
        .sort(
          (a, b) =>
            new Date(b.created).getTime() - new Date(a.created).getTime(),
        )
        .slice(0, 20);
      for (const task of recent) {
        items.push({
          id: `task-${task.id}`,
          label: `${task.title} (${task.state})`,
          category: "task",
          icon: FileText,
          onSelect: () => {
            setSelectedTaskId(task.id);
            navigate("/tasks");
          },
        });
      }
    }

    // Proposals (limit to 20 most recent)
    if (proposals) {
      const recent = [...proposals]
        .sort(
          (a, b) =>
            new Date(b.created).getTime() - new Date(a.created).getTime(),
        )
        .slice(0, 20);
      for (const proposal of recent) {
        items.push({
          id: `proposal-${proposal.id}`,
          label: proposal.title,
          category: "proposal",
          icon: Lightbulb,
          onSelect: () => navigate("/proposals"),
        });
      }
    }

    return items;
  }, [tasks, proposals, navigate, setSelectedTaskId]);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      // When there's no query, show only pages and actions
      return allItems.filter(
        (item) => item.category === "page" || item.category === "action",
      );
    }
    const q = query.toLowerCase();
    return allItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [allItems, query]);

  // Group filtered items by category
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    for (const item of filteredItems) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return CATEGORY_ORDER.filter((cat) => groups[cat]?.length).map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      items: groups[cat],
    }));
  }, [filteredItems]);

  // Flat list for keyboard navigation indexing
  const flatItems = useMemo(
    () => grouped.flatMap((g) => g.items),
    [grouped],
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(
      `[data-command-index="${selectedIndex}"]`,
    );
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const item = flatItems[selectedIndex];
    if (item) {
      item.onSelect();
      setOpen(false);
    }
  }, [flatItems, selectedIndex, setOpen]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      executeSelected();
    }
  }

  let globalIndex = 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-lg p-0 gap-0 overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Command Palette</DialogTitle>

        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 h-12 px-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-auto py-2">
          {flatItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No results found
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const idx = globalIndex++;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-command-index={idx}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors ${
                        idx === selectedIndex
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
                      }`}
                      onClick={() => {
                        item.onSelect();
                        setOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      {Icon && (
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="flex-1 truncate">{item.label}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0" />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div className="border-t px-3 py-2 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>
            <kbd className="bg-muted px-1 py-0.5 rounded font-mono">
              ↑↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="bg-muted px-1 py-0.5 rounded font-mono">↵</kbd>{" "}
            select
          </span>
          <span>
            <kbd className="bg-muted px-1 py-0.5 rounded font-mono">esc</kbd>{" "}
            close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
