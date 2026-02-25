import { FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDirectoryFeedback } from "@/hooks/use-directory-feedback";
import { useDirectoryPathField } from "@/hooks/use-directory-path-field";
import { useMutationFeedback } from "@/hooks/use-mutation-feedback";
import { getErrorDetail } from "@/lib/error";
import { useUpsertProjectCatalogItem } from "@/queries/projects";

interface ProjectAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPath?: string;
  onAdded?: (project: { path: string; name?: string }) => void;
}

interface FolderCreateFeedback {
  tone: "success" | "error";
  message: string;
}

function validateFolderName(rawName: string): string | null {
  const name = rawName.trim();
  if (!name) return "Enter a folder name.";
  if (name === "." || name === "..")
    return "Use a concrete folder name, not . or ..";
  if (name.includes("/") || name.includes("\\"))
    return "Use only a single folder name (no path separators).";
  return null;
}

function joinChildPath(basePath: string, folderName: string): string {
  if (basePath === "/") return `/${folderName}`;
  return `${basePath.replace(/\/+$/, "")}/${folderName}`;
}

export function ProjectAddDialog({
  open,
  onOpenChange,
  defaultPath,
  onAdded,
}: ProjectAddDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderCreateFeedback, setFolderCreateFeedback] =
    useState<FolderCreateFeedback | null>(null);
  const pathInputId = useId();
  const nameInputId = useId();
  const directoryFeedbackId = useId();
  const newFolderNameError = useMemo(
    () => validateFolderName(newFolderName),
    [newFolderName],
  );
  const upsertProject = useUpsertProjectCatalogItem();
  const {
    clearError: clearSubmitError,
    pendingStatusMessage,
    errorMessage: submitErrorMessage,
  } = useMutationFeedback(upsertProject, {
    action: "Failed to add project",
    nextStep: "Verify the path and try again.",
    pendingMessage: "Adding project...",
  });
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
    path,
    setPath,
    clearSubmitError,
    onDirectorySelected: () => {
      setShowNewFolder(false);
      setNewFolderName("");
      setFolderCreateFeedback(null);
    },
  });
  const directoryFeedback = useDirectoryFeedback({
    loading: browseLoading,
    browseError,
    selectionNotice,
  });

  useEffect(() => {
    if (open) {
      setPath(defaultPath || "");
      setName("");
      clearSubmitError();
      clearSelectionNotice();
      setFolderCreateFeedback(null);
    } else {
      closeBrowser();
    }
  }, [open, defaultPath, closeBrowser, clearSelectionNotice, clearSubmitError]);

  const createFolder = async () => {
    if (!browseResult) return;
    const trimmedName = newFolderName.trim();
    const nameError = validateFolderName(trimmedName);
    if (nameError) {
      setFolderCreateFeedback({
        tone: "error",
        message: `${nameError} Rename the folder and try again.`,
      });
      return;
    }

    const folderPath = joinChildPath(browseResult.current, trimmedName);
    setCreating(true);
    setFolderCreateFeedback(null);
    try {
      await api.browse.mkdir(folderPath);
      selectDirectory(folderPath);
      setFolderCreateFeedback({
        tone: "success",
        message: `Created and selected directory: ${folderPath}`,
      });
    } catch (error) {
      const detail = getErrorDetail(error);
      setFolderCreateFeedback({
        tone: "error",
        message: `Failed to create folder: ${detail}. Check permissions or use a different name, then retry.`,
      });
      // re-browse to show current state
      await navigateBrowser(browseResult.current);
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = () => {
    if (!path.trim()) return;
    const nextPath = path.trim();
    const nextName = name.trim() || undefined;
    clearSubmitError();
    upsertProject.mutate(
      { path: nextPath, name: nextName },
      {
        onSuccess: () => {
          onOpenChange(false);
          onAdded?.({ path: nextPath, name: nextName });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Register a repository path so tasks and proposals can be organized
            by project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor={pathInputId} className="text-sm font-medium mb-1.5 block">
              Project Path
            </label>
            <div className="flex gap-1">
              <Input
                id={pathInputId}
                placeholder="~/git/my-project"
                value={path}
                onChange={(e) => {
                  setFolderCreateFeedback(null);
                  handlePathChange(e.target.value);
                }}
                className="flex-1"
                aria-describedby={directoryFeedback ? directoryFeedbackId : undefined}
                aria-invalid={directoryFeedback?.tone === "error" || undefined}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setFolderCreateFeedback(null);
                  void openPathBrowser();
                }}
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
                className="mt-2 border rounded-md max-h-52 overflow-auto bg-muted/40"
                role="region"
                aria-label="Directory browser"
                aria-busy={browseLoading}
              >
                <header className="px-3 py-1.5 border-b flex items-center justify-between gap-2">
                  <span className="text-xs font-mono truncate">
                    {browseResult.current}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      type="button"
                      onClick={() => {
                        setFolderCreateFeedback(null);
                        setShowNewFolder(!showNewFolder);
                        setNewFolderName("");
                      }}
                    >
                      <FolderPlus className="h-3 w-3 mr-1" /> New
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs"
                      type="button"
                      onClick={() => selectDirectory(browseResult.current)}
                    >
                      Select
                    </Button>
                  </div>
                </header>
                {showNewFolder && (
                  <div className="px-3 py-1.5 border-b space-y-1.5">
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="folder name"
                        value={newFolderName}
                        onChange={(e) => {
                          setFolderCreateFeedback(null);
                          setNewFolderName(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void createFolder();
                          }
                        }}
                        className="h-6 text-xs flex-1"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 text-xs px-2"
                        onClick={() => void createFolder()}
                        disabled={Boolean(newFolderNameError) || creating}
                        aria-label="Create folder in current directory"
                      >
                        {creating ? "..." : "Create"}
                      </Button>
                    </div>
                    {newFolderNameError && (
                      <p className="text-xs text-destructive" role="alert">
                        {newFolderNameError}
                      </p>
                    )}
                  </div>
                )}
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
            {creating && (
              <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                Creating folder...
              </p>
            )}
            {folderCreateFeedback && !creating && (
              <p
                className={`mt-2 text-xs ${folderCreateFeedback.tone === "error" ? "text-destructive" : "text-emerald-400"}`}
                role={folderCreateFeedback.tone === "error" ? "alert" : "status"}
                aria-live={folderCreateFeedback.tone === "error" ? "assertive" : "polite"}
              >
                {folderCreateFeedback.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={nameInputId} className="text-sm font-medium mb-1.5 block">
              Label (optional)
            </label>
            <Input
              id={nameInputId}
              placeholder="e.g. Console Frontend"
              value={name}
              onChange={(e) => {
                clearSubmitError();
                setName(e.target.value);
              }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!path.trim() || upsertProject.isPending}
            >
              {upsertProject.isPending ? "Adding..." : "Add Project"}
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
