import { useId, useState } from "react";
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
import { useMutationFeedback } from "@/hooks/use-mutation-feedback";
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
  const projectInputId = useId();
  const pipelineLabelId = useId();
  const maxItemsInputId = useId();
  const setSelectedSessionId = useUiStore((s) => s.setSelectedSessionId);

  const startAutopilot = useStartAutopilot();
  const {
    clearError: clearStartError,
    pendingStatusMessage,
    errorMessage: startError,
  } = useMutationFeedback(startAutopilot, {
    action: "Failed to start session",
    nextStep: "Check the project path and try again.",
    pendingMessage: "Starting session...",
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      clearStartError();
    }
    onOpenChange(nextOpen);
  };

  const handleStart = () => {
    if (!project.trim()) return;
    clearStartError();
    startAutopilot.mutate(
      {
        project: project.trim(),
        pipeline,
        maxItems: parseInt(maxItems, 10) || 50,
      },
      {
        onSuccess: (data) => {
          setProject("");
          clearStartError();
          if (data?.sessionId) {
            setSelectedSessionId(data.sessionId);
          }
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Autopilot Session</DialogTitle>
          <DialogDescription>
            Start an automated development session for a project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor={projectInputId}
              className="text-sm font-medium mb-1.5 block"
            >
              Project Path
            </label>
            <Input
              id={projectInputId}
              placeholder="~/my-project"
              value={project}
              onChange={(e) => {
                clearStartError();
                setProject(e.target.value);
              }}
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-1.5 block" id={pipelineLabelId}>
                Pipeline
              </label>
              <Select
                value={pipeline}
                onValueChange={(value) => {
                  clearStartError();
                  setPipeline(value);
                }}
              >
                <SelectTrigger aria-labelledby={pipelineLabelId}>
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
              <label
                htmlFor={maxItemsInputId}
                className="text-sm font-medium mb-1.5 block"
              >
                Max Items
              </label>
              <Input
                id={maxItemsInputId}
                type="number"
                value={maxItems}
                onChange={(e) => {
                  clearStartError();
                  setMaxItems(e.target.value);
                }}
              />
            </div>
          </div>

          {startError && (
            <p className="text-sm text-destructive" role="alert">
              {startError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStart}
              disabled={!project.trim() || startAutopilot.isPending}
            >
              {startAutopilot.isPending ? "Starting..." : "Start Session"}
            </Button>
          </div>
          {pendingStatusMessage && (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {pendingStatusMessage}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
