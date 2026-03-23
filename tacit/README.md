# Tacit

Tacit is an LLM-assisted commit authoring toolkit for coding agents.

It is not a long-term memory database. Tacit keeps a small hot scratchpad in
`.git/tacit/session.json`, then compiles the useful residue into git history at
commit time.

## Model

- Repo is truth.
- Session state is temporary.
- Long-term recall should come from git history, touched paths, touched symbols,
  and repo docs.
- Questions are fallback, not the main path.

## Hot State vs Cold State

Hot state lives outside the repo:

- `.git/tacit/session.json`
- current intent
- decisions
- failed attempts
- verification notes
- constraints

Cold state stays in the repo:

- commit messages
- `docs/decisions/*`
- `docs/failures/*`

Tacit uses the hot state only while the session is active. After that, recall
should primarily come from git and repo docs.

## What Tacit Does

- records session residue with `tacit begin` and `tacit record`
- retrieves relevant residue with `tacit resume`
- captures verification with `tacit verify -- <command...>`
- reads staged diff plus bounded repo context
- reads active session residue matched by path and symbol
- reads recent git history for touched paths and changed symbols
- reads nearby repo docs such as `AGENTS.md`, `README.md`, and staged
  decision/failure docs
- asks a provider LLM to draft a structured commit plan
- falls back internally to a deterministic draft if the provider path fails
- writes the draft to `.git/TACIT_COMMIT_MSG`
- hands the draft to git through
  [prepare-commit-msg](/home/eugene/git/ucm/.githooks/prepare-commit-msg)

## Retrieval

Tacit does not do broad semantic memory search.

It recalls context in this order:

1. current session residue in `.git/tacit/session.json`
2. recent git history for the touched paths
3. recent git history for the changed symbols
4. repo docs that are already near the change or staged with it

That keeps recall local to the current change instead of inventing a second
source of truth.

## Current Flow

1. Start or refresh the scratchpad with `tacit begin`.
2. Record important residue during the session with `tacit record`.
3. Run verification through `tacit verify -- <command...>` when it matters.
4. Stage files.
5. Run `tacit commit`.
6. Tacit gathers:
   - staged diff
   - repo docs
   - session residue
   - path history
   - symbol history
7. Tacit writes `.git/TACIT_COMMIT_MSG`.
8. Run `git commit`.

## CLI

```bash
node tacit/src/cli.js begin "compile session context into commits"
node tacit/src/cli.js record decision "use .git/tacit/session.json as hot state" --path tacit/src/commit-flow.js --symbol runCommitFlow
node tacit/src/cli.js record verification "npm test" --path tacit/src/commit-flow.js
node tacit/src/cli.js resume --path tacit/src/commit-flow.js --symbol runCommitFlow
node tacit/src/cli.js verify --path tacit/src/commit-flow.js --symbol runCommitFlow -- npm test
node tacit/src/cli.js commit --provider codex
node tacit/src/cli.js commit --dry-run
node tacit/src/cli.js promote decision "switch Tacit to session scratchpad"
node tacit/src/cli.js generate-commit-message
```

## Providers

Tacit currently reuses the repo's CLI provider layer and can call:

- `codex`
- `claude`
- `gemini`

Provider-specific prompt profiles and a local response contract keep the output
shape stable even when the models differ. The CLI always tries the provider
path first and falls back internally if that path fails. `tacit commit` is
silent-first by default; use `--interactive` only when you explicitly want a
question loop.
