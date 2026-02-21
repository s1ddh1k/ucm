import { useState, useMemo } from "react";
import { Lightbulb, Eye, Search as SearchIcon, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProposalCard } from "@/components/proposals/proposal-card";
import { ProposalDetailDialog } from "@/components/proposals/proposal-detail-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { StatusDot } from "@/components/shared/status-dot";
import {
  useProposalsQuery, useApproveProposal, useRejectProposal,
  useSetProposalPriority, useObserverStatusQuery, useRunObserver,
  useAnalyzeProject, useResearchProject,
} from "@/queries/proposals";
import { useUiStore } from "@/stores/ui";
import type { Proposal } from "@/api/types";

export default function ProposalsPage() {
  const [detailProposal, setDetailProposal] = useState<Proposal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const proposalFilter = useUiStore((s) => s.proposalFilter);
  const categoryFilter = useUiStore((s) => s.proposalCategoryFilter);
  const riskFilter = useUiStore((s) => s.proposalRiskFilter);
  const setProposalFilter = useUiStore((s) => s.setProposalFilter);
  const setCategoryFilter = useUiStore((s) => s.setProposalCategoryFilter);
  const setRiskFilter = useUiStore((s) => s.setProposalRiskFilter);

  const { data: proposals, isLoading } = useProposalsQuery();
  const { data: observerStatus } = useObserverStatusQuery();
  const runObserver = useRunObserver();
  const approveProposal = useApproveProposal();
  const rejectProposal = useRejectProposal();
  const setPriority = useSetProposalPriority();
  const analyzeProject = useAnalyzeProject();
  const researchProject = useResearchProject();

  const filteredProposals = useMemo(() => {
    if (!proposals) return [];
    let result = [...proposals];
    if (proposalFilter) result = result.filter((p) => p.status === proposalFilter);
    if (categoryFilter) result = result.filter((p) => p.category === categoryFilter);
    if (riskFilter) result = result.filter((p) => p.risk === riskFilter);
    result.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return result;
  }, [proposals, proposalFilter, categoryFilter, riskFilter]);

  const handleApprove = (id: string) => {
    approveProposal.mutate(id);
    setDetailOpen(false);
  };
  const handleReject = (id: string) => {
    rejectProposal.mutate(id);
    setDetailOpen(false);
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="p-6 space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Observer:</span>
            <StatusDot status={observerStatus?.cycle ? "done" : "offline"} />
            <span>Cycle {observerStatus?.cycle ?? 0}</span>
            {observerStatus?.lastRunAt && (
              <span className="text-xs text-muted-foreground">
                Last run: {new Date(observerStatus.lastRunAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => runObserver.mutate()}
            disabled={runObserver.isPending}
          >
            <Eye className="h-4 w-4" /> Run Observer
          </Button>
          <Button size="sm" variant="outline" onClick={() => analyzeProject.mutate(".")} disabled={analyzeProject.isPending}>
            <SearchIcon className="h-4 w-4" /> Analyze
          </Button>
          <Button size="sm" variant="outline" onClick={() => researchProject.mutate(".")} disabled={researchProject.isPending}>
            <FlaskConical className="h-4 w-4" /> Research
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Select value={proposalFilter || "all"} onValueChange={(v) => setProposalFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="proposed">Proposed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="implemented">Implemented</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="template">Template</SelectItem>
            <SelectItem value="core">Core</SelectItem>
            <SelectItem value="config">Config</SelectItem>
            <SelectItem value="test">Test</SelectItem>
            <SelectItem value="bugfix">Bugfix</SelectItem>
            <SelectItem value="ux">UX</SelectItem>
            <SelectItem value="architecture">Architecture</SelectItem>
            <SelectItem value="performance">Performance</SelectItem>
            <SelectItem value="docs">Docs</SelectItem>
            <SelectItem value="research">Research</SelectItem>
          </SelectContent>
        </Select>

        <Select value={riskFilter || "all"} onValueChange={(v) => setRiskFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue placeholder="Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risks</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {filteredProposals.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No proposals"
          description="Run the observer to generate improvement proposals"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onApprove={() => handleApprove(proposal.id)}
              onReject={() => handleReject(proposal.id)}
              onPriorityUp={() => setPriority.mutate({ proposalId: proposal.id, delta: 1 })}
              onPriorityDown={() => setPriority.mutate({ proposalId: proposal.id, delta: -1 })}
              onClick={() => {
                setDetailProposal(proposal);
                setDetailOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <ProposalDetailDialog
        proposal={detailProposal}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
