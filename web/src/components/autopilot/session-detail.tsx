import { useState } from "react";
import { Pause, Play, Square, Check, X, MessageSquare, Plus, Pencil, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusDot } from "@/components/shared/status-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { formatDate } from "@/lib/format";
import {
  useAutopilotSessionQuery,
  usePauseAutopilot, useResumeAutopilot, useStopAutopilot,
  useApproveAutopilotItem, useRejectAutopilotItem, useFeedbackAutopilotItem,
  useAddDirective, useDeleteDirective,
} from "@/queries/autopilot";

interface SessionDetailProps {
  sessionId: string;
}

export function SessionDetail({ sessionId }: SessionDetailProps) {
  const { data: session } = useAutopilotSessionQuery(sessionId);
  const [feedbackText, setFeedbackText] = useState("");
  const [directiveText, setDirectiveText] = useState("");

  const pauseAp = usePauseAutopilot();
  const resumeAp = useResumeAutopilot();
  const stopAp = useStopAutopilot();
  const approveItem = useApproveAutopilotItem();
  const rejectItem = useRejectAutopilotItem();
  const feedbackItem = useFeedbackAutopilotItem();
  const addDirective = useAddDirective();
  const deleteDirective = useDeleteDirective();

  if (!session) return null;

  const progress = session.stats.totalItems > 0
    ? Math.round((session.stats.completedItems / session.stats.totalItems) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{session.projectName}</h2>
            <div className="flex items-center gap-2 mt-1">
              <StatusDot status={session.status} />
              <span className="text-sm text-muted-foreground">{session.status}</span>
              <span className="text-xs text-muted-foreground font-mono">{session.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.status === "running" || session.status === "planning" || session.status === "releasing" ? (
              <Button size="sm" variant="outline" onClick={() => pauseAp.mutate(sessionId)}>
                <Pause className="h-4 w-4" /> Pause
              </Button>
            ) : session.status === "paused" ? (
              <Button size="sm" variant="outline" onClick={() => resumeAp.mutate(sessionId)}>
                <Play className="h-4 w-4" /> Resume
              </Button>
            ) : null}
            {session.status !== "stopped" && session.status !== "completed" && (
              <Button size="sm" variant="destructive" onClick={() => stopAp.mutate(sessionId)}>
                <Square className="h-4 w-4" /> Stop
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress: {session.stats.completedItems}/{session.stats.totalItems}</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} />
        </div>
      </div>

      {/* Review Actions */}
      {session.status === "awaiting_review" && (
        <div className="p-4 border-b bg-purple-400/5 space-y-2">
          <p className="text-sm font-medium text-purple-400">Awaiting Review</p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => approveItem.mutate(sessionId)}>
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => rejectItem.mutate(sessionId)}>
              <X className="h-4 w-4" /> Reject
            </Button>
            <div className="flex items-center gap-1 flex-1">
              <Input
                placeholder="Feedback..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  feedbackItem.mutate({ sessionId, feedback: feedbackText });
                  setFeedbackText("");
                }}
                disabled={!feedbackText}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="roadmap" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 justify-start">
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
          <TabsTrigger value="releases">Releases</TabsTrigger>
          <TabsTrigger value="directives">Directives</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto">
          <TabsContent value="roadmap" className="p-4 mt-0">
            <div className="space-y-2">
              {session.roadmap.length === 0 ? (
                <p className="text-sm text-muted-foreground">No roadmap yet</p>
              ) : (
                session.roadmap.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
                    <StatusDot status={item.status} />
                    <Badge variant="outline" className="text-xs">{item.type}</Badge>
                    <span className="text-sm flex-1 truncate">{item.title}</span>
                    <span className="text-xs text-muted-foreground">{item.status}</span>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="releases" className="p-4 mt-0">
            {session.releases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No releases yet</p>
            ) : (
              <div className="space-y-4">
                {session.releases.map((release) => (
                  <div key={release.version} className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">v{release.version}</h3>
                      <span className="text-xs text-muted-foreground">{formatDate(release.timestamp)}</span>
                    </div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{release.changelog}</pre>
                    {release.tag && (
                      <Badge variant="outline" className="text-xs">{release.tag}</Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="directives" className="p-4 mt-0 space-y-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a directive..."
                value={directiveText}
                onChange={(e) => setDirectiveText(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                onClick={() => {
                  addDirective.mutate({ sessionId, text: directiveText });
                  setDirectiveText("");
                }}
                disabled={!directiveText.trim()}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {(session.directives || []).map((d) => (
                <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                  <Badge variant={d.status === "pending" ? "default" : "secondary"} className="text-xs">
                    {d.status}
                  </Badge>
                  <span className="text-sm flex-1">{d.text}</span>
                  {d.status === "pending" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => deleteDirective.mutate({ sessionId, directiveId: d.id })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="log" className="p-0 mt-0">
            <ScrollArea className="h-full">
              <pre className="p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                {session.log.map((entry) => (
                  <div key={entry.timestamp + entry.message}>
                    <span className="text-muted-foreground/50">{formatDate(entry.timestamp)}</span>
                    {" "}
                    <span className={entry.type === "error" ? "text-red-400" : entry.type === "warn" ? "text-yellow-400" : ""}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </pre>
            </ScrollArea>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
