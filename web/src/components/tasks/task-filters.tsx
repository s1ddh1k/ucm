import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UNKNOWN_PROJECT_KEY } from "@/lib/project";
import { useUiStore } from "@/stores/ui";

interface TaskProjectOption {
  key: string;
  label: string;
}

interface TaskFiltersProps {
  projectOptions: TaskProjectOption[];
  projectValue?: string;
  projectScopeLocked?: boolean;
}

export function TaskFilters({
  projectOptions,
  projectValue,
  projectScopeLocked = false,
}: TaskFiltersProps) {
  const taskFilter = useUiStore((s) => s.taskFilter);
  const taskSort = useUiStore((s) => s.taskSort);
  const taskSearch = useUiStore((s) => s.taskSearch);
  const setTaskFilter = useUiStore((s) => s.setTaskFilter);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const setTaskSort = useUiStore((s) => s.setTaskSort);
  const setTaskSearch = useUiStore((s) => s.setTaskSearch);

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 border-b">
      <Select
        value={taskFilter || "all"}
        onValueChange={(v) => setTaskFilter(v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-24 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="running">Running</SelectItem>
          <SelectItem value="review">Review</SelectItem>
          <SelectItem value="done">Done</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>

      {!projectScopeLocked && (
        <Select
          value={projectValue || "all"}
          onValueChange={(v) => setTaskProjectFilter(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-44 h-8">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project.key} value={project.key}>
                {project.key === UNKNOWN_PROJECT_KEY
                  ? "Unknown Project"
                  : project.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select
        value={taskSort}
        onValueChange={(v) =>
          setTaskSort(v as "created" | "priority" | "title")
        }
      >
        <SelectTrigger className="w-24 h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created">Newest</SelectItem>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="title">Title</SelectItem>
        </SelectContent>
      </Select>

      <div className="relative flex-1">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={taskSearch}
          onChange={(e) => setTaskSearch(e.target.value)}
          className="h-8 pl-7 text-sm"
        />
      </div>
    </div>
  );
}
