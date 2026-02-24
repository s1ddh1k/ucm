import { useState } from "react";
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
import { useStartAutopilot } from "@/queries/autopilot";
import { useUiStore } from "@/stores/ui";

interface SessionStartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SessionStartDialog({
  open,
  onOpenChange,
}: SessionStartDialogProps) {
  const [project, setProject] = useState("");
  const [pipeline, setPipeline] = useState("small");
  const [maxItems, setMaxItems] = useState("50");
  const setSelectedSessionId = useUiStore((s) => s.setSelectedSessionId);

  const startAutopilot = useStartAutopilot();

  const handleStart = () => {
    if (!project.trim()) return;
    startAutopilot.mutate(
      {
        project: project.trim(),
        pipeline,
        maxItems: parseInt(maxItems, 10) || 50,
      },
      {
        onSuccess: (data) => {
          setProject("");
          if (data?.sessionId) {
            setSelectedSessionId(data.sessionId);
          }
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Autopilot Session</DialogTitle>
          <DialogDescription>
            Start an automated development session for a project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              Project Path
            </label>
            <Input
              placeholder="~/my-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block">
                Pipeline
              </label>
              <Select value={pipeline} onValueChange={setPipeline}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trivial">Trivial</SelectItem>
                  <SelectItem value="small">Small</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-28">
              <label className="text-sm font-medium mb-1.5 block">
                Max Items
              </label>
              <Input
                type="number"
                value={maxItems}
                onChange={(e) => setMaxItems(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStart}
              disabled={!project.trim() || startAutopilot.isPending}
            >
              {startAutopilot.isPending ? "Starting..." : "Start Session"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
