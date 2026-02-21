import { useState } from "react";
import { Plus, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionCard } from "@/components/autopilot/session-card";
import { SessionDetail } from "@/components/autopilot/session-detail";
import { SessionStartDialog } from "@/components/autopilot/session-start-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutopilotStatusQuery } from "@/queries/autopilot";
import { useUiStore } from "@/stores/ui";

export default function AutopilotPage() {
  const [startOpen, setStartOpen] = useState(false);
  const { data: sessions, isLoading } = useAutopilotStatusQuery();
  const selectedSessionId = useUiStore((s) => s.selectedSessionId);
  const setSelectedSessionId = useUiStore((s) => s.setSelectedSessionId);

  return (
    <div className="flex h-full">
      {/* Session List */}
      <div className="w-72 shrink-0 flex flex-col border-r">
        <div className="p-3 border-b">
          <Button onClick={() => setStartOpen(true)} className="w-full" size="sm">
            <Plus className="h-4 w-4" /> New Session
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-3 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !sessions?.length ? (
            <EmptyState icon={Bot} title="No sessions" description="Start an autopilot session" />
          ) : (
            sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                selected={selectedSessionId === session.id}
                onClick={() => setSelectedSessionId(session.id)}
              />
            ))
          )}
        </ScrollArea>
      </div>

      {/* Session Detail */}
      <div className="flex-1 min-w-0">
        {selectedSessionId ? (
          <SessionDetail sessionId={selectedSessionId} />
        ) : (
          <EmptyState
            icon={Bot}
            title="Select a session"
            description="Choose a session from the list or start a new one"
            className="h-full"
          />
        )}
      </div>

      <SessionStartDialog open={startOpen} onOpenChange={setStartOpen} />
    </div>
  );
}
