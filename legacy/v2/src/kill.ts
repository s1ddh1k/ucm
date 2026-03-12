import { KILL_GRACE_MS } from "./constants.ts";

/**
 * 프로세스 트리 종료.
 * SIGTERM → 프로세스 그룹(-pid)과 pid 모두 → grace 대기 → SIGKILL.
 */
export async function killProcess(pid: number, graceMs = KILL_GRACE_MS): Promise<void> {
  sendSignal(pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, graceMs));
  sendSignal(pid, "SIGKILL");
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  // 프로세스 그룹에 시그널 전송
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: 이미 종료됨
  }
  // 프로세스 자체에도 전송
  try {
    process.kill(pid, signal);
  } catch {
    // ESRCH: 이미 종료됨
  }
}
