import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/api/client";
import type { BrowseResult } from "@/api/types";
import { useUpsertProjectCatalogItem } from "@/queries/projects";

interface ProjectAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPath?: string;
  onAdded?: (project: { path: string; name?: string }) => void;
}

export function ProjectAddDialog({ open, onOpenChange, defaultPath, onAdded }: ProjectAddDialogProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const upsertProject = useUpsertProjectCatalogItem();

  useEffect(() => {
    if (open) {
      setPath(defaultPath || "");
      setName("");
      setBrowseResult(null);
      setBrowsing(false);
    }
  }, [open, defaultPath]);

  const openBrowser = async () => {
    try {
      const result = await api.browse.list(path || undefined);
      setBrowseResult(result);
      setBrowsing(true);
    } catch {}
  };

  const navigateBrowser = async (dirPath: string) => {
    try {
      const result = await api.browse.list(dirPath);
      setBrowseResult(result);
    } catch {}
  };

  const selectDirectory = (dirPath: string) => {
    setPath(dirPath);
    setBrowsing(false);
    setBrowseResult(null);
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
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Register a repository path so tasks and proposals can be organized by project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Project Path</label>
            <div className="flex gap-1">
              <Input
                placeholder="~/git/my-project"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="icon" onClick={openBrowser} title="Browse directories">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            {browsing && browseResult && (
              <div className="mt-2 border rounded-md max-h-52 overflow-auto bg-muted/40">
                <div className="px-3 py-1.5 border-b flex items-center justify-between gap-2">
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

          <div>
            <label className="text-sm font-medium mb-1.5 block">Label (optional)</label>
            <Input
              placeholder="e.g. Console Frontend"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!path.trim() || upsertProject.isPending}>
              {upsertProject.isPending ? "Adding..." : "Add Project"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
