import { RotateCw, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import type { Proposal } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RISK_COLORS, type RiskLevel } from "@/lib/constants";
import { getProposalProjectLabel, getProposalProjectPath } from "@/lib/project";
import { cn } from "@/lib/utils";

interface ProposalDetailDialogProps {
  proposal: Proposal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  approvePending?: boolean;
  rejectPending?: boolean;
  deletePending?: boolean;
  actionDisabled?: boolean;
}

export function ProposalDetailDialog({
  proposal,
  open,
  onOpenChange,
  onApprove,
  onReject,
  onDelete,
  approvePending = false,
  rejectPending = false,
  deletePending = false,
  actionDisabled = false,
}: ProposalDetailDialogProps) {
  if (!proposal) return null;

  const riskColor =
    RISK_COLORS[proposal.risk as RiskLevel] || "text-muted-foreground";
  const isActionable = proposal.status === "proposed";
  const projectLabel = getProposalProjectLabel(proposal);
  const projectPath = getProposalProjectPath(proposal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline">{proposal.category}</Badge>
            <span className={cn("text-xs font-medium", riskColor)}>
              {proposal.risk} risk
            </span>
            <Badge variant="secondary" className="text-xs">
              {proposal.status}
            </Badge>
            <Badge
              variant="outline"
              className="text-xs font-normal"
              title={projectPath || projectLabel}
            >
              {projectLabel}
            </Badge>
          </div>
          <DialogTitle>{proposal.title}</DialogTitle>
          <DialogDescription>Priority: {proposal.priority}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {proposal.problem && (
            <Section title="Problem" content={proposal.problem} />
          )}
          {proposal.change && (
            <Section title="Proposed Change" content={proposal.change} />
          )}
          {proposal.expectedImpact && (
            <Section
              title="Expected Impact"
              content={proposal.expectedImpact}
            />
          )}

          {proposal.evaluation && (
            <div className="rounded-lg bg-muted p-3 space-y-1">
              <h4 className="text-sm font-medium">Evaluation</h4>
              <p className="text-xs text-muted-foreground">
                Regulator:{" "}
                {proposal.evaluation.regulatorApproved ? "Approved" : "Blocked"}
                {proposal.evaluation.regulatorReason &&
                  ` - ${proposal.evaluation.regulatorReason}`}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {isActionable && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={actionDisabled || rejectPending}
                  onClick={() => onReject(proposal.id)}
                >
                  {rejectPending ? (
                    <RotateCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ThumbsDown className="h-4 w-4" />
                  )}{" "}
                  Reject
                </Button>
                <Button
                  size="sm"
                  disabled={actionDisabled || approvePending}
                  onClick={() => onApprove(proposal.id)}
                >
                  {approvePending ? (
                    <RotateCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <ThumbsUp className="h-4 w-4" />
                  )}{" "}
                  Approve
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={deletePending || actionDisabled}
              onClick={() => onDelete(proposal.id)}
            >
              {deletePending ? (
                <RotateCw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}{" "}
              {deletePending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h4 className="text-sm font-medium mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
        {content}
      </p>
    </div>
  );
}
