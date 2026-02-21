import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSubmitTask } from "@/queries/tasks";
import { useProjectCatalogQuery } from "@/queries/projects";
import { useUiStore } from "@/stores/ui";
import { api } from "@/api/client";
import type { BrowseResult } from "@/api/types";

const PIPELINE_INFO: Record<string, { stages: string; desc: string }> = {
  trivial: { stages: "implement → verify → deliver", desc: "Single file edit, simple bug fix" },
  small: { stages: "design → implement → verify → deliver", desc: "A few files, clearly scoped change" },
  medium: { stages: "clarify → specify → design → implement → verify → ux-review → polish → deliver", desc: "Multi-file feature, design decisions required" },
  large: { stages: "clarify → specify → decompose → design → implement → verify → ux-review → polish → integrate → deliver", desc: "Multi-module, architecture-level changes" },
};

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectPath?: string;
}

export function TaskCreateDialog({ open, onOpenChange, defaultProjectPath }: TaskCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [project, setProject] = useState("");
  const [pipeline, setPipeline] = useState("medium");
  const [priority, setPriority] = useState("0");
  const [browsing, setBrowsing] = useState(false);
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);

  const submitTask = useSubmitTask();
  const { data: projectCatalog } = useProjectCatalogQuery();
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);

  useEffect(() => {
    if (open && defaultProjectPath) {
      setProject(defaultProjectPath);
    }
  }, [open, defaultProjectPath]);

  const handleSubmit = () => {
    if (!title.trim()) return;

    submitTask.mutate(
      {
        title: title.trim(),
        body: body.trim() || undefined,
        project: project.trim() || undefined,
        pipeline,
        priority: parseInt(priority) || 0,
      },
      {
        onSuccess: (data) => {
          const newId = (data as { id?: string })?.id;
          setTitle("");
          setBody("");
          setProject("");
          setPipeline("medium");
          setPriority("0");
          onOpenChange(false);
          if (newId) {
            setSelectedTaskId(newId);
          }
        },
      }
    );
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen && defaultProjectPath) {
      setProject(defaultProjectPath);
    }
    onOpenChange(nextOpen);
  };

  const openBrowser = async () => {
    try {
      const result = await api.browse.list(project || undefined);
      setBrowseResult(result);
      setBrowsing(true);
    } catch {
      // fallback: just keep the input
    }
  };

  const selectDirectory = (dirPath: string) => {
    setProject(dirPath);
    setBrowsing(false);
    setBrowseResult(null);
  };

  const navigateBrowser = async (dirPath: string) => {
    try {
      const result = await api.browse.list(dirPath);
      setBrowseResult(result);
    } catch {}
  };

  const info = PIPELINE_INFO[pipeline];

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>Create a new task for the daemon to process.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Title</label>
            <Input
              placeholder="Task title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <textarea
              placeholder="Task description (optional)..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Project Path</label>
            {(projectCatalog?.length || 0) === 0 && (
              <p className="text-xs text-amber-400 mb-2">
                No registered project yet. Add one in Projects for better task organization.
              </p>
            )}
            {(projectCatalog?.length || 0) > 0 && (
              <Select
                value={project || "__custom__"}
                onValueChange={(value) => setProject(value === "__custom__" ? "" : value)}
              >
                <SelectTrigger className="mb-2">
                  <SelectValue placeholder="Select from registered projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">Custom path...</SelectItem>
                  {(projectCatalog || []).map((entry) => (
                    <SelectItem key={entry.path} value={entry.path}>
                      {entry.name ? `${entry.name} · ${entry.path}` : entry.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-1">
              <Input
                placeholder="~/my-project (optional)"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="icon" onClick={openBrowser} title="Browse directories">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {browsing && browseResult && (
              <div className="mt-2 border rounded-md max-h-48 overflow-auto bg-muted/50">
                <div className="px-3 py-1.5 border-b flex items-center justify-between">
                  <span className="text-xs font-mono truncate">{browseResult.current}</span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => selectDirectory(browseResult.current)}>
                    Select
                  </Button>
                </div>
                {browseResult.parent && (
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 text-muted-foreground"
                    onClick={() => navigateBrowser(browseResult.parent)}
                  >
                    ..
                  </button>
                )}
                {browseResult.directories.map((dir) => (
                  <button
                    key={dir.path}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 font-mono"
                    onClick={() => navigateBrowser(dir.path)}
                  >
                    {dir.name}/
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">Pipeline</label>
              <Select value={pipeline} onValueChange={setPipeline}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PIPELINE_INFO).map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      <span className="capitalize">{key}</span>
                      <span className="text-muted-foreground ml-1 text-xs">- {val.desc}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {info && (
                <p className="text-xs text-muted-foreground mt-1.5">{info.stages}</p>
              )}
            </div>

            <div className="w-24">
              <label className="text-sm font-medium mb-1.5 block">
                Priority
              </label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">Higher = sooner</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!title.trim() || submitTask.isPending}>
              {submitTask.isPending ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
