# Tacit Design

## Goal

Turn session residue into better commit history without introducing a durable
memory database.

## Core Thesis

- The repository is the source of truth.
- Session state is useful only while the work is in progress.
- After the work lands, recall should come from git history and repo docs.

## Storage Model

Tacit uses two layers.

### Hot State

Stored in `.git/tacit/session.json`.

- `intent`
- `decision`
- `attempt`
- `verification`
- `constraint`

This state is local, temporary, and safe to discard.

### Cold State

Stored in the repo.

- commit messages
- decision docs
- failure docs

This is what future sessions should actually rely on.

## Retrieval Model

Tacit should not do broad “memory search”.

It should retrieve only residue that is local to the current work:

1. session residue matched by touched paths
2. session residue matched by changed symbols
3. recent git history for touched paths
4. recent git history for changed symbols
5. nearby or staged repo docs

Branch names are not durable enough to be retrieval keys.

## Commit Compilation

`tacit commit` should compile from:

- staged diff
- changed symbols
- related caller/test snippets
- current session residue
- recent path history
- recent symbol history
- repo docs

The LLM should produce a bounded commit plan:

- `type`
- `scope`
- `subject`
- `whyBullets`
- `changeBullets`
- `verificationBullets`
- `notesBullets`
- `refs`
- `questions`

## Silent-First Behavior

The preferred behavior is:

- infer as much as possible from the session and repo
- ask no question when the draft is already good enough
- only ask when the rationale or verification is missing in a way that matters

Questions are fallback, not the default UX.

## CLI Surface

The current CLI should cover five jobs:

1. `begin`
   reset the hot scratchpad and set the current intent
2. `record`
   append residue events with optional `path` and `symbol` tags
3. `resume`
   retrieve relevant hot residue plus git/path/symbol history
4. `verify`
   run a verification command and append the result to session residue
5. `commit`
   compile the final commit draft

`commit` should not expose an `LLM on/off` toggle in the user-facing CLI.
Provider execution and fallback are internal policy, not user workflow.
`commit` should also be silent-first by default and require an explicit
interactive flag before it starts asking questions.

## Follow-up Work

- agent-skill wrapper that records residue automatically during a session
- automatic capture of executed verification commands
- removal or hard deprecation of legacy `new` / `handoff` entrypoints after the
  skill wrapper is in place
- promotion flow from session residue to decision/failure docs when the context
  is too large for a commit message
- stronger symbol extraction outside JS/TS
