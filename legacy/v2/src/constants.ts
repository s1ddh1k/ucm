export const ENV_EXACT = [
  "PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "HOSTNAME", "LOGNAME",
  "EDITOR", "VISUAL", "DISPLAY", "TMPDIR", "TMP", "TEMP",
  "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME", "JAVA_HOME", "ANDROID_HOME",
  "VIRTUAL_ENV", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
] as const;

export const ENV_PREFIXES = [
  "LC_", "NODE_", "NPM_", "NVM_", "GIT_", "XDG_", "SSH_",
  "GPG_", "CONDA_", "PYENV_", "DBUS_", "GEMINI_", "GOOGLE_",
] as const;

export const RATE_LIMIT_RE = /rate.limit|429|quota|overloaded/i;

export const BACKOFF_DELAYS = [5_000, 10_000, 20_000, 40_000] as const;

export const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50MB

export const KILL_GRACE_MS = 1_200;

export const LOOP_DETECT_THRESHOLD = 3;

export const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // 5분
export const DEFAULT_HARD_TIMEOUT_MS = 30 * 60 * 1000;  // 30분
export const DEFAULT_MAX_ITERATIONS = 10;

export const CONSECUTIVE_ERROR_LIMIT = 3;
