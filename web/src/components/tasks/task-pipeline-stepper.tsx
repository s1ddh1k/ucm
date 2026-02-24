import { Check, Circle, Pause, Play } from "lucide-react";
import { PIPELINES, type PipelineName } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface TaskPipelineStepperProps {
  pipeline?: string;
  currentStage?: string;
  state: string;
  stageGate?: string;
}

export function TaskPipelineStepper({
  pipeline,
  currentStage,
  state,
  stageGate,
}: TaskPipelineStepperProps) {
  const pipelineName = (pipeline || "small") as PipelineName;
  const stages = PIPELINES[pipelineName] || PIPELINES.small;

  const currentIndex = currentStage
    ? stages.indexOf(currentStage as never)
    : -1;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {stages.map((stage, i) => {
        const isGateWaiting = stageGate === stage && state === "running";
        const isDone =
          state === "done" || state === "review" ? true : currentIndex > i;
        const isCurrent =
          currentIndex === i && state === "running" && !isGateWaiting;
        const isPending = !isDone && !isCurrent && !isGateWaiting;

        return (
          <div key={stage} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={cn(
                  "h-px w-4",
                  isDone
                    ? "bg-emerald-400"
                    : isGateWaiting
                      ? "bg-amber-400"
                      : "bg-muted",
                )}
              />
            )}
            <div className="flex items-center gap-1">
              <div
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                  isDone && "bg-emerald-400/20 text-emerald-400",
                  isCurrent &&
                    "bg-blue-400/20 text-blue-400 animate-pulse ring-2 ring-blue-400/30",
                  isGateWaiting && "bg-amber-400/20 text-amber-400",
                  isPending && "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? (
                  <Check className="h-3 w-3" />
                ) : isGateWaiting ? (
                  <Pause className="h-3 w-3" />
                ) : isCurrent ? (
                  <Play className="h-3 w-3" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs whitespace-nowrap",
                  isDone && "text-emerald-400",
                  isCurrent && "text-blue-400 font-medium",
                  isGateWaiting && "text-amber-400 font-medium",
                  isPending && "text-muted-foreground",
                )}
              >
                {stage}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
