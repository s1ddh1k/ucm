import { FolderOpen } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDirectoryFeedback } from "@/hooks/use-directory-feedback";
import { useDirectoryPathField } from "@/hooks/use-directory-path-field";
import { useMutationFeedback } from "@/hooks/use-mutation-feedback";
import { useProjectCatalogQuery } from "@/queries/projects";
import { useSubmitTask } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";

const PIPELINE_INFO: Record<string, { stages: string; desc: string }> = {
  trivial: {
    stages: "implement → verify → deliver",
    desc: "Single file edit, simple bug fix",
  },
  small: {
    stages: "design → implement → verify → deliver",
    desc: "A few files, clearly scoped change",
  },
  medium: {
    stages:
      "clarify → specify → design → implement → verify → ux-review → polish → deliver",
    desc: "Multi-file feature, design decisions required",
  },
  large: {
    stages:
      "clarify → specify → decompose → design → implement → verify → ux-review → polish → integrate → deliver",
    desc: "Multi-module, architecture-level changes",
  },
};

type PipelineType = keyof typeof PIPELINE_INFO;

function isPipelineType(value: string): value is PipelineType {
  return value in PIPELINE_INFO;
}

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectPath?: string;
}

export function TaskCreateDialog({
  open,
  onOpenChange,
  defaultProjectPath,
}: TaskCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [project, setProject] = useState("");
  const [pipeline, setPipeline] = useState<PipelineType>("medium");
  const [priority, setPriority] = useState("0");
  const titleInputId = useId();
  const descriptionInputId = useId();
  const projectInputId = useId();
  const priorityInputId = useId();
  const directoryFeedbackId = useId();

  const submitTask = useSubmitTask();
  const {
    clearError: clearSubmitError,
    pendingStatusMessage,
    errorMessage: submitErrorMessage,
  } = useMutationFeedback(submitTask, {
    action: "Failed to create task",
    nextStep: "Check your inputs and retry.",
    pendingMessage: "Creating task...",
  });
  const { data: projectCatalog } = useProjectCatalogQuery();
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const {
    browsing,
    loading: browseLoading,
    browseResult,
    browseError,
    openPathBrowser,
    navigateBrowser,
    closeBrowser,
    handlePathChange,
    selectDirectory,
    selectionNotice,
    clearSelectionNotice,
  } = useDirectoryPathField({
    path: project,
    setPath: setProject,
    clearSubmitError,
  });
  const directoryFeedback = useDirectoryFeedback({
    loading: browseLoading,
    browseError,
    selectionNotice,
  });

  useEffect(() => {
    if (open && defaultProjectPath) {
      setProject(defaultProjectPath);
    }
    if (open) {
      clearSubmitError();
    }
  }, [open, defaultProjectPath, clearSubmitError]);

  const handleSubmit = () => {
    if (!title.trim()) return;

    clearSubmitError();
    submitTask.mutate(
      {
        title: title.trim(),
        body: body.trim() || undefined,
        project: project.trim() || undefined,
        pipeline,
        priority: parseInt(priority, 10) || 0,
      },
      {
        onSuccess: (data) => {
          const newId = data.id;
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
      },
    );
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen && defaultProjectPath) {
      setProject(defaultProjectPath);
    }
    if (!nextOpen) {
      closeBrowser();
      clearSubmitError();
      clearSelectionNotice();
    }
    onOpenChange(nextOpen);
  };

  const info = PIPELINE_INFO[pipeline];

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
          <DialogDescription>
            Create a new task for the daemon to process.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor={titleInputId} className="text-sm font-medium mb-1.5 block">
              Title
            </label>
            <Input
              id={titleInputId}
              placeholder="Task title..."
              value={title}
              onChange={(e) => {
                clearSubmitError();
                setTitle(e.target.value);
              }}
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor={descriptionInputId}
              className="text-sm font-medium mb-1.5 block"
            >
              Description
            </label>
            <textarea
              id={descriptionInputId}
              placeholder="Task description (optional)..."
              value={body}
              onChange={(e) => {
                clearSubmitError();
                setBody(e.target.value);
              }}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          <div>
            <label htmlFor={projectInputId} className="text-sm font-medium mb-1.5 block">
              Project Path
            </label>
            {(projectCatalog?.length || 0) === 0 && (
              <p className="text-xs text-amber-400 mb-2">
                No registered project yet. Add one in Projects for better task
                organization.
              </p>
            )}
            {(projectCatalog?.length || 0) > 0 && (
              <Select
                value={project || "__custom__"}
                onValueChange={(value) => {
                  clearSubmitError();
                  setProject(value === "__custom__" ? "" : value);
                }}
              >
                <SelectTrigger className="mb-2">
                  <SelectValue placeholder="Select from registered projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">Custom path...</SelectItem>
                  {(projectCatalog || []).map((entry) => (
                    <SelectItem key={entry.path} value={entry.path}>
                      {entry.name
                        ? `${entry.name} · ${entry.path}`
                        : entry.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-1">
              <Input
                id={projectInputId}
                placeholder="~/my-project (optional)"
                value={project}
                onChange={(e) => handlePathChange(e.target.value)}
                className="flex-1"
                aria-describedby={directoryFeedback ? directoryFeedbackId : undefined}
                aria-invalid={directoryFeedback?.tone === "error" || undefined}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void openPathBrowser()}
                title="Browse directories"
                aria-label="Browse directories"
                disabled={browseLoading}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {directoryFeedback && (
              <p
                id={directoryFeedbackId}
                className={`mt-2 text-xs ${
                  directoryFeedback.tone === "error"
                    ? "text-destructive"
                    : "text-muted-foreground"
                }`}
                role={directoryFeedback.role}
                aria-live={directoryFeedback.ariaLive}
              >
                {directoryFeedback.message}
              </p>
            )}
            {browsing && browseResult && (
              <section
                className="mt-2 border rounded-md max-h-48 overflow-auto bg-muted/50"
                aria-label="Directory browser"
                aria-busy={browseLoading}
              >
                <header className="px-3 py-1.5 border-b flex items-center justify-between">
                  <span className="text-xs font-mono truncate">
                    {browseResult.current}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    type="button"
                    onClick={() => selectDirectory(browseResult.current)}
                  >
                    Select
                  </Button>
                </header>
                <ul>
                  {browseResult.parent && (
                    <li>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 text-muted-foreground"
                        onClick={() => void navigateBrowser(browseResult.parent)}
                        disabled={browseLoading}
                      >
                        ..
                      </button>
                    </li>
                  )}
                  {browseResult.directories.length === 0 && (
                    <li>
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No subdirectories found.
                      </p>
                    </li>
                  )}
                  {browseResult.directories.map((dir) => (
                    <li key={dir.path}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 font-mono"
                        onClick={() => void navigateBrowser(dir.path)}
                        disabled={browseLoading}
                      >
                        {dir.name}/
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">
                Pipeline
              </label>
              <Select
                value={pipeline}
                onValueChange={(value) => {
                  if (isPipelineType(value)) {
                    clearSubmitError();
                    setPipeline(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PIPELINE_INFO).map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      <span className="capitalize">{key}</span>
                      <span className="text-muted-foreground ml-1 text-xs">
                        - {val.desc}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {info && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  {info.stages}
                </p>
              )}
            </div>

            <div className="w-24">
              <label htmlFor={priorityInputId} className="text-sm font-medium mb-1.5 block">
                Priority
              </label>
              <Input
                id={priorityInputId}
                type="number"
                value={priority}
                onChange={(e) => {
                  clearSubmitError();
                  setPriority(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Higher = sooner
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!title.trim() || submitTask.isPending}
            >
              {submitTask.isPending ? "Creating..." : "Create Task"}
            </Button>
          </div>
          {pendingStatusMessage && (
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {pendingStatusMessage}
            </p>
          )}
          {submitErrorMessage && (
            <p className="text-xs text-destructive" role="alert">
              {submitErrorMessage}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
