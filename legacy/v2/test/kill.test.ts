import { describe, it, assert } from "./harness.ts";
import { killProcess } from "../src/kill.ts";
import { spawn } from "node:child_process";

describe("kill.ts", () => {
  it("kills a running process", async () => {
    const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    const pid = child.pid!;

    // 프로세스가 살아있는지 확인
    assert.equal(isAlive(pid), true, "process should be alive");

    await killProcess(pid, 100);

    // 약간의 시간 대기 (SIGKILL 처리)
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(isAlive(pid), false, "process should be dead");
  });

  it("handles already-dead process gracefully", async () => {
    const child = spawn("true", [], { detached: true, stdio: "ignore" });
    const pid = child.pid!;

    // 프로세스가 종료될 때까지 대기
    await new Promise<void>((r) => child.on("exit", () => r()));

    // 이미 죽은 프로세스에 kill → 에러 없이 완료
    await killProcess(pid, 50);
  });

  it("kills process group (detached children)", async () => {
    // 자식 프로세스를 스폰하는 스크립트 실행
    const child = spawn("bash", ["-c", "sleep 60 & sleep 60 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    assert.equal(isAlive(pid), true);

    await killProcess(pid, 100);
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(isAlive(pid), false, "parent should be dead");
  });

  it("SIGTERM allows graceful shutdown within grace period", async () => {
    // trap SIGTERM and exit gracefully
    const child = spawn("bash", ["-c", 'trap "exit 0" SIGTERM; sleep 60'], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;

    // Give trap time to register
    await new Promise((r) => setTimeout(r, 50));

    await killProcess(pid, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(isAlive(pid), false);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
