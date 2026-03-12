import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ucm-test-"));
  await $`git init ${dir}`.quiet();
  await $`git -C ${dir} config user.email "test@test.com"`.quiet();
  await $`git -C ${dir} config user.name "Test"`.quiet();
  // 초기 커밋 (빈 커밋은 worktree에서 문제 발생 가능)
  await Bun.write(join(dir, "README.md"), "# test\n");
  await $`git -C ${dir} add .`.quiet();
  await $`git -C ${dir} commit -m "init"`.quiet();
  return dir;
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function mockAgentPath(): string {
  return join(import.meta.dir, "mock-agent.ts");
}

export function mockAgentCmd(): { cmd: string; args: string[] } {
  return { cmd: "bun", args: [mockAgentPath()] };
}
