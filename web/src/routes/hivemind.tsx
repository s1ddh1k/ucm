import {
  BarChart3,
  Brain,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Zettel, ZettelSearchResult } from "@/api/types";
import {
  useDeleteZettel,
  useGcMutation,
  useHivemindListQuery,
  useHivemindSearchQuery,
  useHivemindShowQuery,
  useHivemindStatsQuery,
  useReindexMutation,
} from "@/queries/hivemind";

const TABS = [
  { key: "explore", label: "Explore", icon: Search },
  { key: "stats", label: "Stats", icon: BarChart3 },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type ListItem = Zettel | ZettelSearchResult;

function getKeywordLabels(
  keywords: Record<string, number> | undefined,
): string[] {
  if (!keywords || typeof keywords !== "object") return [];
  return Object.keys(keywords);
}

export default function HivemindPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabKey) || "explore";

  function switchTab(key: TabKey) {
    const next = new URLSearchParams(searchParams);
    if (key === "explore") {
      next.delete("tab");
    } else {
      next.set("tab", key);
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-6 flex items-center gap-1">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30"
              }`}
              onClick={() => switchTab(key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "explore" && <ExploreTab />}
        {activeTab === "stats" && <StatsTab />}
      </div>
    </div>
  );
}

// ── Explore Tab ──

function ExploreTab() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const { data: stats } = useHivemindStatsQuery();

  const kindOptions = useMemo(() => {
    const kinds = stats?.byKind ? Object.keys(stats.byKind).sort() : [];
    return [
      { value: "", label: "All" },
      ...kinds.map((k) => ({ value: k, label: k })),
    ];
  }, [stats?.byKind]);

  const isSearching = !!debouncedQuery.trim();

  const {
    data: searchResults,
    isLoading: searchLoading,
    isError: searchError,
  } = useHivemindSearchQuery(debouncedQuery);
  const {
    data: listResults,
    isLoading: listLoading,
    isError: listError,
  } = useHivemindListQuery(kindFilter || undefined);

  const zettelList: ListItem[] | undefined = isSearching
    ? searchResults
    : listResults;
  const isLoading = isSearching ? searchLoading : listLoading;
  const isError = isSearching ? searchError : listError;

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(value), 300);
  }

  return (
    <div className="h-full flex">
      {/* Left panel: list */}
      <div className="w-80 shrink-0 border-r flex flex-col min-h-0">
        {/* Search + filters */}
        <div className="p-3 border-b space-y-2">
          <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search zettels..."
              aria-label="Search zettels"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            aria-label="Filter by kind"
            className="w-full text-xs bg-muted/50 border border-border rounded-md px-2 py-1.5 outline-none"
          >
            {kindOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Zettel list */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Loading...
            </p>
          ) : isError ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Could not load zettels. Is the hivemind daemon running?
            </p>
          ) : !zettelList?.length ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {isSearching ? "No results" : "No zettels"}
            </p>
          ) : (
            zettelList.map((z) => (
              <ZettelListItem
                key={z.id}
                item={z}
                selected={selectedId === z.id}
                onClick={() => setSelectedId(z.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel: detail */}
      <div className="flex-1 min-h-0 overflow-auto">
        {selectedId ? (
          <ZettelDetail id={selectedId} onNavigate={setSelectedId} />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <div className="text-center space-y-2">
              <Brain className="h-8 w-8 mx-auto opacity-50" />
              <p>Select a zettel to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ZettelListItem({
  item,
  selected,
  onClick,
}: {
  item: ListItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border/50 transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
      )}
    >
      <p className="text-sm font-medium truncate">{item.title}</p>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
          {item.kind}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
        {"score" in item && (
          <span className="text-[10px] text-muted-foreground">
            score: {item.score.toFixed(2)}
          </span>
        )}
      </div>
    </button>
  );
}

function ZettelDetail({
  id,
  onNavigate,
}: {
  id: string;
  onNavigate: (id: string) => void;
}) {
  const { data: zettel, isLoading, isError } = useHivemindShowQuery(id);
  const deleteMutation = useDeleteZettel();
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [id]);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Loading...
      </p>
    );
  }

  if (isError || !zettel) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Zettel not found
      </p>
    );
  }

  const keywordLabels = getKeywordLabels(zettel.keywords);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">{zettel.title}</h2>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
          <span className="font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
            {zettel.kind}
          </span>
          <span>{new Date(zettel.createdAt).toLocaleString()}</span>
          {zettel.supersededBy && (
            <span className="text-orange-400 font-medium">superseded</span>
          )}
        </div>
      </div>

      {/* Keywords */}
      {keywordLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywordLabels.map((kw) => (
            <span
              key={kw}
              className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* Links */}
      {(zettel.links?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {zettel.links!.map((linkId) => (
            <button
              key={linkId}
              onClick={() => onNavigate(linkId)}
              className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono hover:bg-blue-500/20 transition-colors"
            >
              {linkId}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="border-t pt-4">
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {zettel.body}
        </div>
      </div>

      {/* Source */}
      {zettel.source && (
        <div className="border-t pt-3 text-xs text-muted-foreground">
          <span className="font-medium">Source:</span>{" "}
          {zettel.source.adapter}
          {zettel.source.ref && (
            <span className="ml-1 font-mono">{zettel.source.ref}</span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t pt-3 flex gap-2">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Confirm?</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteMutation.mutate(id);
                setConfirmDelete(false);
              }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Stats Tab ──

function StatsTab() {
  const { data: stats, isLoading, isError } = useHivemindStatsQuery();
  const gcMutation = useGcMutation();
  const reindexMutation = useReindexMutation();
  const [confirmGc, setConfirmGc] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading stats...</div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Could not load stats. Is the hivemind daemon running?
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Zettels" value={stats.totalZettels} />
        <StatCard label="Keywords" value={stats.totalKeywords} />
        <StatCard label="Queue" value={stats.queueLength} />
        <StatCard label="Processing" value={stats.processing ? 1 : 0} />
      </div>

      {/* By Kind */}
      {stats.byKind && Object.keys(stats.byKind).length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">By Kind</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(stats.byKind)
              .sort(([, a], [, b]) => b - a)
              .map(([kind, count]) => (
                <div
                  key={kind}
                  className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-sm"
                >
                  <span className="font-medium">{kind}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="border-t pt-4 flex gap-3">
        {confirmGc ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Run GC?</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                gcMutation.mutate(false);
                setConfirmGc(false);
              }}
              disabled={gcMutation.isPending}
            >
              Confirm
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                gcMutation.mutate(true);
                setConfirmGc(false);
              }}
              disabled={gcMutation.isPending}
            >
              Dry Run
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmGc(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmGc(true)}
            disabled={gcMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Run GC
          </Button>
        )}

        {confirmReindex ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Reindex?</span>
            <Button
              size="sm"
              onClick={() => {
                reindexMutation.mutate();
                setConfirmReindex(false);
              }}
              disabled={reindexMutation.isPending}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReindex(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmReindex(true)}
            disabled={reindexMutation.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reindex
          </Button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
