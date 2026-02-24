import { FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
import { useDirectoryBrowser } from "@/hooks/use-directory-browser";
import { useUpsertProjectCatalogItem } from "@/queries/projects";

interface ProjectAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPath?: string;
  onAdded?: (project: { path: string; name?: string }) => void;
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
  const pathInputId = useId();
  const nameInputId = useId();
  const upsertProject = useUpsertProjectCatalogItem();
  const {
    browsing,
    loading: browseLoading,
    browseResult,
    browseError,
    openBrowser,
    navigateBrowser,
    closeBrowser,
    clearBrowseError,
  } = useDirectoryBrowser();

  useEffect(() => {
    if (open) {
      setPath(defaultPath || "");
      setName("");
    } else {
      closeBrowser();
    }
  }, [open, defaultPath, closeBrowser]);

  const selectDirectory = (dirPath: string) => {
    setPath(dirPath);
    closeBrowser();
    setShowNewFolder(false);
    setNewFolderName("");
  };

  const createFolder = async () => {
    if (!newFolderName.trim() || !browseResult) return;
    const folderPath = browseResult.current + "/" + newFolderName.trim();
    setCreating(true);
    try {
      await api.browse.mkdir(folderPath);
      selectDirectory(folderPath);
    } catch {
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
  const submitErrorMessage =
    upsertProject.error instanceof Error ? upsertProject.error.message : null;

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
                  clearBrowseError();
                  setPath(e.target.value);
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void openBrowser(path || undefined)}
                title="Browse directories"
                aria-label="Browse directories"
                disabled={browseLoading}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {browseLoading && (
              <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
                Loading directories...
              </p>
            )}
            {browseError && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {browseError}
              </p>
            )}
            {browsing && browseResult && (
              <div
                className="mt-2 border rounded-md max-h-52 overflow-auto bg-muted/40"
                aria-label="Directory browser"
              >
                <div className="px-3 py-1.5 border-b flex items-center justify-between gap-2">
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
                </div>
                {showNewFolder && (
                  <div className="px-3 py-1.5 border-b flex items-center gap-1">
                    <Input
                      placeholder="folder name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
                      className="h-6 text-xs flex-1"
                      autoFocus
                    />
                    <Button size="sm" variant="default" className="h-6 text-xs px-2" onClick={createFolder} disabled={!newFolderName.trim() || creating}>
                      {creating ? "..." : "Create"}
                    </Button>
                  </div>
                )}
                {browseResult.parent && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 text-muted-foreground"
                    onClick={() => void navigateBrowser(browseResult.parent)}
                    disabled={browseLoading}
                  >
                    ..
                  </button>
                )}
                {browseResult.directories.map((dir) => (
                  <button
                    type="button"
                    key={dir.path}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50 font-mono"
                    onClick={() => void navigateBrowser(dir.path)}
                    disabled={browseLoading}
                  >
                    {dir.name}/
                  </button>
                ))}
              </div>
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
              onChange={(e) => setName(e.target.value)}
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
          {submitErrorMessage && (
            <p className="text-xs text-destructive" role="alert">
              Failed to add project: {submitErrorMessage}. Verify the path and
              try again.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
