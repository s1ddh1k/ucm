import { useMemo, useEffect, useState } from "react";
import {
  Lightbulb,
  Eye,
  Search as SearchIcon,
  FlaskConical,
  LayoutGrid,
  List,
  Check,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProposalCard } from "@/components/proposals/proposal-card";
import { ProposalDetailDialog } from "@/components/proposals/proposal-detail-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { StatusDot } from "@/components/shared/status-dot";
import {
  useProposalsQuery, useApproveProposal, useRejectProposal,
  useSetProposalPriority, useObserverStatusQuery, useRunObserver,
  useAnalyzeProject, useResearchProject, useDeleteProposal,
} from "@/queries/proposals";
import { useUiStore } from "@/stores/ui";
import type { Proposal } from "@/api/types";
import {
  getProjectKey, getProjectLabel, getProposalProjectPath, UNKNOWN_PROJECT_KEY,
} from "@/lib/project";

interface ConfirmProposalAction {
  type: "reject" | "delete";
  proposalId: string;
  proposalTitle: string;
}

interface PendingProposalAction {
  type: "approve" | "reject" | "delete";
  proposalId: string;
}

export function ProposalInboxContent() {
  const [detailProposal, setDetailProposal] = useState<Proposal | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [confirmAction, setConfirmAction] = useState<ConfirmProposalAction | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingProposalAction | null>(null);

  const proposalFilter = useUiStore((s) => s.proposalFilter);
  const proposalProjectFilter = useUiStore((s) => s.proposalProjectFilter);
  const categoryFilter = useUiStore((s) => s.proposalCategoryFilter);
  const riskFilter = useUiStore((s) => s.proposalRiskFilter);
  const setProposalFilter = useUiStore((s) => s.setProposalFilter);
  const setProposalProjectFilter = useUiStore((s) => s.setProposalProjectFilter);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setCategoryFilter = useUiStore((s) => s.setProposalCategoryFilter);
  const setRiskFilter = useUiStore((s) => s.setProposalRiskFilter);

  const { data: proposals, isLoading } = useProposalsQuery(undefined, detailOpen);
  const { data: observerStatus } = useObserverStatusQuery();
  const runObserver = useRunObserver();
  const approveProposal = useApproveProposal();
  const rejectProposal = useRejectProposal();
  const deleteProposal = useDeleteProposal();
  const setPriority = useSetProposalPriority();
  const analyzeProject = useAnalyzeProject();
  const researchProject = useResearchProject();

  useEffect(() => {
    clearActiveProject();
    setProposalProjectFilter("");
  }, [clearActiveProject, setProposalProjectFilter]);

  const projectOptions = useMemo(() => {
    if (!proposals) return [];
    const unique = new Map<string, string>();
    for (const proposal of proposals) {
      const projectPath = getProposalProjectPath(proposal);
      const key = getProjectKey(projectPath);
      if (!unique.has(key)) {
        unique.set(key, getProjectLabel(projectPath));
      }
    }
    const labelCounts = new Map<string, number>();
    for (const label of unique.values()) {
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
    return [...unique.entries()]
      .map(([key, label]) => {
        const duplicated = (labelCounts.get(label) || 0) > 1 && key !== UNKNOWN_PROJECT_KEY;
        return { key, label: duplicated ? `${label} \u00b7 ${key}` : label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [proposals]);

  const STATUS_OPTIONS = [
    { value: "", label: "All" },
    { value: "proposed", label: "Proposed" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "implemented", label: "Done" },
  ];

  const filteredProposals = useMemo(() => {
    if (!proposals) return [];
    let result = [...proposals];
    if (proposalFilter) result = result.filter((p) => p.status === proposalFilter);
    if (proposalProjectFilter) {
      result = result.filter((p) => getProjectKey(getProposalProjectPath(p)) === proposalProjectFilter);
    }
    if (categoryFilter) result = result.filter((p) => p.category === categoryFilter);
    if (riskFilter) result = result.filter((p) => p.risk === riskFilter);
    result.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return result;
  }, [proposals, proposalFilter, proposalProjectFilter, categoryFilter, riskFilter]);

  const actionsLocked = setPriority.isPending || pendingAction !== null;

  const handleApprove = (id: string) => {
    setPendingAction({ type: "approve", proposalId: id });
    approveProposal.mutate(id, {
      onSuccess: () => {
        setDetailOpen(false);
      },
      onSettled: () => {
        setPendingAction((current) =>
          current?.proposalId === id && current.type === "approve"
            ? null
            : current,
        );
      },
    });
  };

  const requestReject = (proposal: Proposal) => {
    setConfirmAction({
      type: "reject",
      proposalId: proposal.id,
      proposalTitle: proposal.title,
    });
  };

  const requestDelete = (proposal: Proposal) => {
    setConfirmAction({
      type: "delete",
      proposalId: proposal.id,
      proposalTitle: proposal.title,
    });
  };

  const handleRejectFromId = (id: string) => {
    const proposal =
      proposals?.find((item) => item.id === id) ||
      (detailProposal?.id === id ? detailProposal : null);
    if (!proposal) return;
    requestReject(proposal);
  };

  const handleDeleteFromId = (id: string) => {
    const proposal =
      proposals?.find((item) => item.id === id) ||
      (detailProposal?.id === id ? detailProposal : null);
    if (!proposal) return;
    requestDelete(proposal);
  };

  const handleConfirmAction = () => {
    if (!confirmAction) return;
    const { proposalId, type } = confirmAction;
    setPendingAction({ proposalId, type });

    if (type === "reject") {
      rejectProposal.mutate(proposalId, {
        onSuccess: () => {
          setConfirmAction(null);
          setDetailOpen(false);
        },
        onSettled: () => {
          setPendingAction((current) =>
            current?.proposalId === proposalId && current.type === "reject"
              ? null
              : current,
          );
        },
      });
      return;
    }

    deleteProposal.mutate(proposalId, {
      onSuccess: () => {
        setConfirmAction(null);
        if (detailProposal?.id === proposalId) setDetailOpen(false);
      },
      onSettled: () => {
        setPendingAction((current) =>
          current?.proposalId === proposalId && current.type === "delete"
            ? null
            : current,
        );
      },
    });
  };

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      {/* Filters + View Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-md border divide-x">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                proposalFilter === opt.value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
              onClick={() => setProposalFilter(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
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
          <SelectTrigger className="w-28 h-7 text-xs"><SelectValue placeholder="Risk" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risks</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>

        <Select value={proposalProjectFilter || "all"} onValueChange={(v) => setProposalProjectFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44 h-7 text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projectOptions.map((project) => (
              <SelectItem key={project.key} value={project.key}>
                {project.key === UNKNOWN_PROJECT_KEY ? "Unknown Project" : project.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center border rounded-md">
          <button className={`p-1.5 ${viewMode === "grid" ? "bg-accent" : "hover:bg-accent/50"}`} onClick={() => setViewMode("grid")} title="Grid view">
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button className={`p-1.5 ${viewMode === "list" ? "bg-accent" : "hover:bg-accent/50"}`} onClick={() => setViewMode("list")} title="List view">
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Observer Status + Actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => runObserver.mutate()} disabled={runObserver.isPending}>
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

      {/* Proposals */}
      {filteredProposals.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No proposals" description="Run the observer to generate improvement proposals" />
      ) : viewMode === "list" ? (
        <div className="border rounded-md divide-y">
          {filteredProposals.map((proposal) => (
            <div
              key={proposal.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors"
              onClick={() => { setDetailProposal(proposal); setDetailOpen(true); }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{proposal.title}</p>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0">{proposal.category}</Badge>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${
                proposal.risk === "high" ? "bg-red-500/20 text-red-400" :
                proposal.risk === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                "bg-emerald-500/20 text-emerald-400"
              }`}>{proposal.risk}</span>
              <span className="text-xs text-muted-foreground w-8 text-center shrink-0">{proposal.priority || 0}</span>
                  {proposal.status === "proposed" && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-emerald-400 hover:text-emerald-300"
                        disabled={actionsLocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApprove(proposal.id);
                        }}
                      >
                        {pendingAction?.proposalId === proposal.id &&
                        pendingAction?.type === "approve" ? (
                          <RotateCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                        disabled={actionsLocked}
                        onClick={(e) => {
                          e.stopPropagation();
                          requestReject(proposal);
                        }}
                      >
                        {pendingAction?.proposalId === proposal.id &&
                        pendingAction?.type === "reject" ? (
                          <RotateCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onApprove={() => handleApprove(proposal.id)}
              onReject={() => requestReject(proposal)}
              onDelete={() => requestDelete(proposal)}
              approvePending={
                pendingAction?.proposalId === proposal.id &&
                pendingAction?.type === "approve"
              }
              rejectPending={
                pendingAction?.proposalId === proposal.id &&
                pendingAction?.type === "reject"
              }
              deletePending={
                pendingAction?.proposalId === proposal.id &&
                pendingAction?.type === "delete"
              }
              actionDisabled={actionsLocked}
              onPriorityUp={() => setPriority.mutate({ proposalId: proposal.id, delta: 1 })}
              onPriorityDown={() => setPriority.mutate({ proposalId: proposal.id, delta: -1 })}
              onClick={() => { setDetailProposal(proposal); setDetailOpen(true); }}
            />
          ))}
        </div>
      )}

      <ProposalDetailDialog
        proposal={detailProposal}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onApprove={handleApprove}
        onReject={handleRejectFromId}
        onDelete={handleDeleteFromId}
        approvePending={
          pendingAction?.proposalId === detailProposal?.id &&
          pendingAction?.type === "approve"
        }
        rejectPending={
          pendingAction?.proposalId === detailProposal?.id &&
          pendingAction?.type === "reject"
        }
        deletePending={
          pendingAction?.proposalId === detailProposal?.id &&
          pendingAction?.type === "delete"
        }
        actionDisabled={actionsLocked}
      />

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.type === "reject"
                ? "Reject this proposal?"
                : "Delete this proposal?"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.type === "reject"
                ? "Rejecting marks this proposal as declined. You can still review it later in the rejected list."
                : "Deleting permanently removes this proposal from the dashboard. This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium truncate">
            {confirmAction?.proposalTitle}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmAction(null)}
              disabled={pendingAction !== null}
            >
              Cancel
            </Button>
            <Button
              variant={
                confirmAction?.type === "delete" ? "destructive" : "default"
              }
              onClick={handleConfirmAction}
              disabled={pendingAction !== null}
            >
              {pendingAction !== null ? (
                <RotateCw className="h-4 w-4 animate-spin" />
              ) : confirmAction?.type === "delete" ? (
                <Trash2 className="h-4 w-4" />
              ) : (
                <X className="h-4 w-4" />
              )}{" "}
              {pendingAction !== null
                ? "Processing..."
                : confirmAction?.type === "delete"
                  ? "Delete Proposal"
                  : "Reject Proposal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
