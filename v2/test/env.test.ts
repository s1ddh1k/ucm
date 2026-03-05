import { describe, it, assert } from "./harness.ts";
import { filterEnv } from "../src/env.ts";

describe("env.ts", () => {
  it("passes exact match variables", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/user", SECRET: "hidden" };
    const result = filterEnv(env);
    assert.equal(result.PATH, "/usr/bin");
    assert.equal(result.HOME, "/home/user");
    assert.equal(result.SECRET, undefined);
  });

  it("passes prefix match variables", () => {
    const env = {
      NODE_ENV: "production",
      NPM_TOKEN: "abc",
      GIT_AUTHOR_NAME: "Test",
      LC_ALL: "en_US.UTF-8",
      RANDOM_VAR: "nope",
    };
    const result = filterEnv(env);
    assert.equal(result.NODE_ENV, "production");
    assert.equal(result.NPM_TOKEN, "abc");
    assert.equal(result.GIT_AUTHOR_NAME, "Test");
    assert.equal(result.LC_ALL, "en_US.UTF-8");
    assert.equal(result.RANDOM_VAR, undefined);
  });

  it("filters out undefined values", () => {
    const env = { PATH: undefined, HOME: "/home" };
    const result = filterEnv(env);
    assert.equal(result.PATH, undefined);
    assert.equal(result.HOME, "/home");
  });

  it("passes API keys", () => {
    const env = { ANTHROPIC_API_KEY: "sk-ant-xxx", OPENAI_API_KEY: "sk-xxx" };
    const result = filterEnv(env);
    assert.equal(result.ANTHROPIC_API_KEY, "sk-ant-xxx");
    assert.equal(result.OPENAI_API_KEY, "sk-xxx");
  });

  it("passes proxy variables", () => {
    const env = { HTTP_PROXY: "http://proxy", HTTPS_PROXY: "https://proxy", NO_PROXY: "localhost" };
    const result = filterEnv(env);
    assert.equal(result.HTTP_PROXY, "http://proxy");
    assert.equal(result.HTTPS_PROXY, "https://proxy");
  });

  it("passes SSH and GPG prefix variables", () => {
    const env = { SSH_AUTH_SOCK: "/tmp/ssh", GPG_TTY: "/dev/tty" };
    const result = filterEnv(env);
    assert.equal(result.SSH_AUTH_SOCK, "/tmp/ssh");
    assert.equal(result.GPG_TTY, "/dev/tty");
  });

  it("passes GEMINI and GOOGLE prefix variables", () => {
    const env = { GEMINI_API_KEY: "gem-xxx", GOOGLE_API_KEY: "goog-xxx" };
    const result = filterEnv(env);
    assert.equal(result.GEMINI_API_KEY, "gem-xxx");
    assert.equal(result.GOOGLE_API_KEY, "goog-xxx");
  });

  it("returns empty for all-blocked env", () => {
    const env = { SECRET: "a", PRIVATE: "b", INTERNAL_KEY: "c" };
    const result = filterEnv(env);
    assert.deepEqual(result, {});
  });
});
