import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/shared/status-dot";
import { wsManager } from "@/api/websocket";
import { useTerminalStore } from "@/stores/terminal";
import { useDaemonStore } from "@/stores/daemon";
import { Plus } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPage() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { spawned, setSpawned, reset } = useTerminalStore();
  const connected = useDaemonStore((s) => s.connected);
  const [sessionStatus, setSessionStatus] = useState<"idle" | "connecting" | "connected">("idle");

  const initTerminal = useCallback(() => {
    if (!termRef.current || xtermRef.current) return;

    const xterm = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#e4e4e7",
        cursor: "#e4e4e7",
        selectionBackground: "#27272a",
        black: "#09090b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    observer.observe(termRef.current);

    // Send typed data to WS as binary
    xterm.onData((data) => {
      const encoder = new TextEncoder();
      wsManager.sendBinary(encoder.encode(data));
    });

    // Receive PTY data from WS
    const unsubData = wsManager.on("pty:data", (eventData) => {
      const buf = eventData.data as ArrayBuffer;
      const decoder = new TextDecoder();
      xterm.write(decoder.decode(buf));
    });

    const unsubSpawned = wsManager.on("pty:spawned", (data) => {
      setSessionStatus("connected");
      setSpawned(true, data.id as number, data.cwd as string);
    });

    const unsubExit = wsManager.on("pty:exit", () => {
      xterm.writeln("\r\n\x1b[33m[Session ended]\x1b[0m");
      setSessionStatus("idle");
      reset();
    });

    const unsubError = wsManager.on("pty:error", (data) => {
      xterm.writeln(`\r\n\x1b[31m[Error: ${data.message}]\x1b[0m`);
      setSessionStatus("idle");
    });

    return () => {
      observer.disconnect();
      unsubData();
      unsubSpawned();
      unsubExit();
      unsubError();
      // Kill PTY session on unmount so we don't leak server-side processes
      wsManager.send("pty:kill");
      reset();
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [setSpawned, reset]);

  useEffect(() => {
    const cleanup = initTerminal();
    return cleanup;
  }, [initTerminal]);

  const spawnSession = (newSession = false) => {
    if (!connected) return;
    setSessionStatus("connecting");
    const dims = fitAddonRef.current?.proposeDimensions();
    wsManager.send("pty:spawn", {
      cols: dims?.cols || 80,
      rows: dims?.rows || 24,
      newSession,
    });
  };

  // Send resize on fit
  useEffect(() => {
    if (!spawned) return;
    const xterm = xtermRef.current;
    if (!xterm) return;

    const disposable = xterm.onResize(({ cols, rows }) => {
      wsManager.send("pty:resize", { cols, rows });
    });
    return () => disposable.dispose();
  }, [spawned]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Terminal</span>
          <div className="flex items-center gap-1.5">
            <StatusDot status={sessionStatus === "connected" ? "running" : "offline"} />
            <span className="text-xs text-muted-foreground">
              {sessionStatus === "connected" ? "Connected" : sessionStatus === "connecting" ? "Connecting..." : "Idle"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!spawned ? (
            <Button size="sm" onClick={() => spawnSession()} disabled={!connected}>
              Start Session
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => spawnSession(true)} disabled={!connected}>
              <Plus className="h-4 w-4" /> New Session
            </Button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 bg-[#0a0a0a] p-1" />
    </div>
  );
}
