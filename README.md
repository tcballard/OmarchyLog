# OmarchyLog

An independent, source-linked changelog for Omarchy. Follow development branches and published releases, explain meaningful changes, and prepare X threads with an auditable archive.

Node 24+. No package installation or runtime dependencies. SQLite stores cursors, evidence, drafts, approvals and delivery receipts.

```bash
node src/cli.mjs baseline
node scripts/poll.mjs
```

`baseline` starts from now. It records current branch heads and existing releases without announcing historical changes. `poll` collects new changes and writes the next draft under `.omarchylog/output/` as JSON, Markdown and an SVG summary card. Run `draft` again to drain any remaining backlog.

The default configuration observes `omacom/omarchy` on `dev`, `rc` and `quattro`, plus its published releases. These refs were checked on 18 October 2026. They are explicitly configured; a branch rename fails visibly. Branch labels do not imply stable distribution or package availability.

## Read the result

```bash
node src/cli.mjs status
node src/cli.mjs show EDITION_ID
```

A draft contains exact source links, immutable comparison SHAs, the selected entries, an omission audit, and the proposed X thread. Overflow stays queued. Re-running collection does not create another event for the same observed range. The same change reaching a second branch is a separate, labelled promotion observation.

Without a model, the draft preserves source headlines and leaves user impact unstated. A branch headline is attributed to its source; it has not been independently validated on a desktop.

## Add a model

The summarizer is a command adapter: one JSON request on stdin, one JSON response on stdout. It runs without a shell. Any model provider, coding agent or local model can implement that contract.

A ready-to-configure OpenAI Responses adapter is included. Set `OPENAI_API_KEY` and `OMARCHYLOG_MODEL` to a model available to your account that supports structured outputs, then change the configuration to:

```json
"summarizer": { "command": ["node", "scripts/openai-summary.mjs"] }
```

Model choice is explicit. The default configuration makes no model calls. The adapter sends collected public source text to the selected provider and requests `store: false`. It does not execute repository instructions or supply model tools. Generation failures stop draft creation; they do not mark events as assigned. Successful responses are cached by evidence, adapter configuration and prompt version. Change the adapter command arguments when changing model settings to invalidate its cache.

The validator rejects unknown event IDs, unsupported categories, supplied URLs/handles, obvious branch-as-shipped wording, missing citations and quotes absent from the collected source. This checks provenance, not semantic truth: an exact quote can still be misinterpreted. Review remains necessary. Input packets over 500 KB fail rather than dropping evidence.

For manual or coding-agent editing, `request EVENT_ID` exports a source packet. Return one summary object per edition entry in an array, then:

```bash
node src/cli.mjs revise EDITION_ID summaries.json
```

Revision preserves collected evidence and regenerates posts. It invalidates previous content approval. Editions cannot be revised after delivery starts.

## Publish to X

Use an OAuth user access token with permission to create posts, together with the intended account's numeric ID. This is a user token, not an app-only bearer token. Token acquisition and refresh remain the operator's responsibility.

```bash
export X_USER_ACCESS_TOKEN='your-user-access-token'
export X_EXPECTED_USER_ID='your-omarchylog-user-id'
node src/cli.mjs approve EDITION_ID
node src/cli.mjs publish EDITION_ID
```

The publisher verifies the account before sending and requires approval of the exact saved content. Each successful reply is saved immediately. If a later reply is rejected, repeating `publish` resumes there. No POST is automatically retried.

A timeout or crash between sending and saving a receipt leaves delivery uncertain. OmarchyLog stops instead of assuming failure. After inspecting the account, either verify the existing post:

```bash
node src/cli.mjs reconcile EDITION_ID PART_INDEX EXISTING_POST_ID
```

or, only when confirmed absent:

```bash
node src/cli.mjs resolve-absent EDITION_ID PART_INDEX --confirmed-absent
```

Part indexes start at zero. Reconciliation checks author, text and reply parent before recording success. This deliberately avoids claiming exactly-once delivery: X does not give this implementation an idempotent create-post transaction. If an operation's process is killed, inspect and stop it before `unlock publisher --confirmed-stopped` (or `collector` / `editor`).

The SVG is an editorial summary card, not a product screenshot. Automated media upload is not implemented. Threads include source links directly; there is no manual source-link reply step.

## Run on GitHub

The included Observe Omarchy workflow runs twice an hour and can be started manually. Its first run automatically records a baseline without importing history. Later runs collect changes and export draft artifacts. Select **baseline** on a manual run to initialise any newly configured streams. The independent `observer-state` branch holds the SQLite archive; it is separate from source code. Set repository Actions permissions to allow this workflow's state commits. It writes only to the OmarchyLog repository, never upstream.

The workflow does not publish to X and has no X credentials. To use generated summaries there, configure an adapter and supply its secrets in the observation step. Branch protection may require a different state store. Back up `observer-state`; ephemeral Actions caches are not the authoritative store. State contains public upstream text and proposed posts and should be treated as public if the repository is public.

Locally, run `node scripts/poll.mjs` from a persistent checkout using your scheduler. Keep `.omarchylog/` on persistent storage and run one collector at a time. The built-in operation locks protect accidental overlapping jobs. No standing chat automation has been created by this project.

## Backfill a chosen range

```bash
node src/cli.mjs backfill omacom/omarchy@dev FULL_40_CHARACTER_BASE_SHA
node scripts/poll.mjs
```

Run baseline first for the other configured streams. Backfill deliberately moves that stream's cursor; retain a backup before changing production state. Use a separate `--db` for experiments. A divergent or rewound branch stops collection until an explicit baseline reset. Collection writes evidence, events and all cursors in one transaction only after every configured source succeeds. GitHub errors never become a successful empty changelog.

`maxPages`, `maxCommits`, `maxItems`, internal-path rules and skip labels are configurable. The collector follows pagination for commits, per-commit files, associated PRs and releases. Missing binary patches stay marked `null`. Full file contents and live desktop behaviour are not captured. Release edits after first observation and release deletions are not tracked in v0.1.0. Cross-branch cherry-pick equivalence and automatic topical grouping across different PRs are not implemented.

## Verify

```bash
npm test
npm run check
```

See [the six-tool review](docs/review.md), [architecture and boundaries](docs/architecture.md), and the [real-source preview](examples/README.md). This is a tested first implementation; live model generation, live X delivery and the deployed GitHub schedule have not been exercised in this environment.
