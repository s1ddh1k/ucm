import type { Proposal } from "@/api/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThumbsUp, ThumbsDown, ArrowUp, ArrowDown } from "lucide-react";
import { RISK_COLORS, type RiskLevel } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface ProposalCardProps {
  proposal: Proposal;
  onApprove: () => void;
  onReject: () => void;
  onPriorityUp: () => void;
  onPriorityDown: () => void;
  onClick: () => void;
}

export function ProposalCard({
  proposal, onApprove, onReject, onPriorityUp, onPriorityDown, onClick,
}: ProposalCardProps) {
  const riskColor = RISK_COLORS[proposal.risk as RiskLevel] || "text-muted-foreground";
  const isActionable = proposal.status === "proposed";

  return (
    <Card className="hover:border-accent transition-colors cursor-pointer" onClick={onClick}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge variant="outline" className="text-xs shrink-0">{proposal.category}</Badge>
          <span className={cn("text-xs font-medium", riskColor)}>
            {proposal.risk} risk
          </span>
        </div>

        <h3 className="text-sm font-medium line-clamp-2">{proposal.title}</h3>

        {proposal.change && (
          <p className="text-xs text-muted-foreground line-clamp-2">{proposal.change}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">Pri: {proposal.priority}</span>
          {isActionable && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPriorityUp}>
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPriorityDown}>
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" onClick={onApprove}>
                <ThumbsUp className="h-3 w-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400" onClick={onReject}>
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
