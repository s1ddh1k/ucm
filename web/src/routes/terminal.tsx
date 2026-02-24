import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerminal } from "@xterm/xterm";
import { Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { wsManager } from "@/api/websocket";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import { useDaemonStore } from "@/stores/daemon";
import { useTerminalStore } from "@/stores/terminal";
import { useUiStore } from "@/stores/ui";
import "@xterm/xterm/css/xterm.css";

const XTERM_THEMES = {
  dark: {
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
  light: {
    background: "#fafafa",
    foreground: "#18181b",
    cursor: "#18181b",
    selectionBackground: "#d4d4d8",
    black: "#18181b",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#fafafa",
    brightBlack: "#71717a",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  },
} as const;

function resolvedTheme(theme: string): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme === "light" ? "light" : "dark";
}

export default function TerminalPage() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawned = useTerminalStore((s) => s.spawned);
  const connected = useDaemonStore((s) => s.connected);
  const theme = useUiStore((s) => s.theme);
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "connecting" | "connected"
  >(() => (useTerminalStore.getState().spawned ? "connected" : "idle"));

  // Initialize xterm and wire up event handlers.
  // PTY is NOT killed on unmount — it stays alive across page navigations.
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return;

    const xterm = new XTerminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      theme: XTERM_THEMES[resolvedTheme(useUiStore.getState().theme)],
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Replay scrollback buffer from previous mount
    const { scrollback } = useTerminalStore.getState();
    if (scrollback.length > 0) {
      for (const chunk of scrollback) {
        xterm.write(chunk);
      }
    }

    // Handle resize
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {}
    });
    observer.observe(termRef.current);

    // Send typed data to WS as binary
    xterm.onData((data) => {
      const encoder = new TextEncoder();
      wsManager.sendBinary(encoder.encode(data));
    });

    // Write incoming PTY data to xterm (scrollback is captured by the store listener)
    const unsubData = wsManager.on("pty:data", (eventData) => {
      const buf = eventData.data as ArrayBuffer;
      xterm.write(new Uint8Array(buf));
    });

    const unsubSpawned = wsManager.on("pty:spawned", () => {
      setSessionStatus("connected");
    });

    const unsubExit = wsManager.on("pty:exit", () => {
      xterm.writeln("\r\n\x1b[33m[Session ended]\x1b[0m");
      setSessionStatus("idle");
    });

    const unsubError = wsManager.on("pty:error", (data) => {
      xterm.writeln(`\r\n\x1b[31m[Error: ${data.message}]\x1b[0m`);
      setSessionStatus("idle");
    });

    // WebSocket reconnect: server killed the PTY, so update UI
    const unsubReconnect = wsManager.on("ws:connected", () => {
      if (useTerminalStore.getState().spawned) {
        xterm.writeln("\r\n\x1b[33m[Connection lost — session ended]\x1b[0m");
        setSessionStatus("idle");
      }
    });

    return () => {
      observer.disconnect();
      unsubData();
      unsubSpawned();
      unsubExit();
      unsubError();
      unsubReconnect();
      // Do NOT kill PTY on unmount — session survives navigation
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync sessionStatus from store (covers external state changes while unmounted)
  useEffect(() => {
    setSessionStatus(spawned ? "connected" : "idle");
  }, [spawned]);

  const spawnSession = (newSession = false) => {
    if (!connected) return;
    setSessionStatus("connecting");
    useTerminalStore.getState().clearScrollback();
    const dims = fitAddonRef.current?.proposeDimensions();
    wsManager.send("pty:spawn", {
      cols: dims?.cols || 80,
      rows: dims?.rows || 24,
      newSession,
    });
  };

  const endSession = () => {
    wsManager.send("pty:kill");
    useTerminalStore.getState().reset();
    useTerminalStore.getState().clearScrollback();
    setSessionStatus("idle");
  };

  // Sync xterm theme when app theme changes
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    xterm.options.theme = XTERM_THEMES[resolvedTheme(theme)];
  }, [theme]);

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
            <StatusDot
              status={sessionStatus === "connected" ? "running" : "offline"}
            />
            <span className="text-xs text-muted-foreground">
              {sessionStatus === "connected"
                ? "Connected"
                : sessionStatus === "connecting"
                  ? "Connecting..."
                  : "Idle"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!spawned ? (
            <Button
              size="sm"
              onClick={() => spawnSession()}
              disabled={!connected}
            >
              Start Session
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => spawnSession(true)}
                disabled={!connected}
              >
                <Plus className="h-4 w-4" /> New Session
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={endSession}
                title="End Session"
              >
                <Square className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div ref={termRef} className="flex-1 bg-background p-1" />
    </div>
  );
}
