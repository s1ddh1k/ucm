import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import * as workspaceDiscovery from "../dist-electron/main/workspace-discovery.js";

test("workspace path normalization expands home shorthand", () => {
  const normalized = workspaceDiscovery.normalizeWorkspacePathInput("~/git");
  assert.equal(normalized, path.join(os.homedir(), "git"));
});

test("workspace path normalization resolves relative paths from cwd", () => {
  const cwd = "/tmp/example-base";
  const normalized = workspaceDiscovery.normalizeWorkspacePathInput("../repo", cwd);
  assert.equal(normalized, "/tmp/repo");
});
