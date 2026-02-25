import {
  ArrowDown,
  ArrowUp,
  RotateCw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import type { Proposal } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RISK_COLORS, type RiskLevel } from "@/lib/constants";
import { getProposalProjectLabel, getProposalProjectPath } from "@/lib/project";
import { cn } from "@/lib/utils";

interface ProposalCardProps {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
  approvePending?: boolean;
  rejectPending?: boolean;
  deletePending?: boolean;
  actionDisabled?: boolean;
  onPriorityUp: () => void;
  onPriorityDown: () => void;
  onClick: () => void;
}

export function ProposalCard({
  proposal,
  onApprove,
  onReject,
  onDelete,
  approvePending = false,
  rejectPending = false,
  deletePending = false,
  actionDisabled = false,
  onPriorityUp,
  onPriorityDown,
  onClick,
}: ProposalCardProps) {
  const riskColor =
    RISK_COLORS[proposal.risk as RiskLevel] || "text-muted-foreground";
  const isActionable = proposal.status === "proposed";
  const projectLabel = getProposalProjectLabel(proposal);
  const projectPath = getProposalProjectPath(proposal);
  const stop = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Card
      className="cursor-pointer border-border bg-card/80 transition-[background-color,border-color,box-shadow] duration-150 hover:bg-accent/35 hover:border-foreground/20 hover:shadow-sm"
      onClick={onClick}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="text-xs shrink-0">
            {proposal.category}
          </Badge>
          <span className={cn("text-xs font-medium", riskColor)}>
            {proposal.risk} risk
          </span>
        </div>

        <h3 className="text-sm font-medium line-clamp-2">{proposal.title}</h3>
        <div>
          <Badge
            variant="outline"
            className="text-[10px] font-normal"
            title={projectPath || projectLabel}
          >
            {projectLabel}
          </Badge>
        </div>

        {proposal.change && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {proposal.change}
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            Pri: {proposal.priority}
          </span>
          <div
            className="flex items-center gap-1"
            onClick={(e) => stop(e)}
            onPointerDown={(e) => stop(e)}
          >
            {isActionable && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={actionDisabled}
                  onClick={(e) => {
                    stop(e);
                    onPriorityUp();
                  }}
                >
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  disabled={actionDisabled}
                  onClick={(e) => {
                    stop(e);
                    onPriorityDown();
                  }}
                >
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-emerald-400"
                  disabled={actionDisabled || approvePending}
                  onClick={(e) => {
                    stop(e);
                    onApprove();
                  }}
                >
                  {approvePending ? (
                    <RotateCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ThumbsUp className="h-3 w-3" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-red-400"
                  disabled={actionDisabled || rejectPending}
                  onClick={(e) => {
                    stop(e);
                    onReject();
                  }}
                >
                  {rejectPending ? (
                    <RotateCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <ThumbsDown className="h-3 w-3" />
                  )}
                </Button>
              </>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive"
              disabled={deletePending || actionDisabled}
              onClick={(e) => {
                stop(e);
                onDelete();
              }}
            >
              {deletePending ? (
                <RotateCw className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
