# Architecture

Independent GitHub observer → immutable source packets → editorial queue → approved edition → durable per-reply outbox.

## Modules

| Module | Responsibility |
|---|---|
| `github.mjs` | Read-only API client, pinned comparisons, bounded pagination, GET retry rules |
| `collect.mjs` | Baselines, commit/PR grouping, release observations, atomic cursor advancement |
| `store.mjs` | SQLite transactions, durable evidence, operation locks |
| `summary.mjs` | Omission rules, command adapter contract, citation checks, versioned summary cache |
| `draft.mjs` | Deterministic ordering, unassigned-event selection, bounded editions |
| `render.mjs` | Source-linked threads, conservative text budget, Markdown and SVG |
| `publish.mjs` | Exact-content approval, account verification, per-part receipts, reconciliation |
| `cli.mjs` | Explicit operating commands |

## What counts as an event

A branch event represents a change observed in an exact before/after ancestry range. Commits with one unambiguous merged PR association group together. Multiple ambiguous associations stay separate unless the API identifies the exact merge commit. A direct commit remains first-class. The evidence retains every collected commit, file summary and available patch; the group does not replace its sources.

A release event represents publication of a GitHub release object. Its `prerelease` field controls the label. A non-prerelease GitHub release is not proof that every package mirror has updated. No version inferred from a commit timestamp is called released.

Branch promotion is intentionally visible, even for a previously reported commit. Event IDs include repository, ref and exact observed range. This avoids conflating development and release-candidate availability, but does not semantically deduplicate cherry-picks.

## Failure and persistence

Collection is all-or-nothing across configured streams. API work occurs before the short SQLite transaction, while a collector lock prevents two collectors from racing cursors. A failed source causes a visible error and no cursor updates. Commit evidence persists once the complete collection succeeds. Completed summaries persist independently, allowing expensive model work to resume after a later summary fails.

An edition captures its evidence and proposed posts. A separate hash approval is valid only for the exact saved edition. Editing exported JSON does not edit the authoritative database: use `revise` and reapprove. SQLite transactions prevent partial archive updates; operation locks remain after an unexpected process kill and require explicit operator recovery.

Before each X write, a sending receipt is persisted. A successful response stores its returned ID. A definitely rejected response can be retried explicitly. All other failures become unknown and block retries. A crash after remote success but before a local receipt cannot be solved by a local transaction; the operator must reconcile. This is safer than blindly reposting, but it is not a distributed exactly-once guarantee.

## Implementation choices

This first version uses Node 24's built-in SQLite, fetch, test runner and process APIs. It has no package-install step and no code vendored from the reviewed projects. The model boundary is an executable argv contract rather than a specific harness dependency. The optional OpenAI adapter is isolated and can be replaced.

The model cannot choose URLs, channel labels, event IDs or reply relationships. Exact citation checks do not establish entailment or neutralise every prompt-injection attempt; no source text is executed, and editorial review remains part of publishing.

## Deliberate v0.1.0 boundaries

- No live desktop claims without separate validation.
- No actual product screenshots or automatic media upload.
- No automatic live-post workflow; scheduled runs generate drafts.
- No OAuth login/refresh UI, hosted dashboard or OpenTweet dependency.
- No release-edit or release-deletion events yet.
- No cross-PR semantic clustering or cherry-pick matching.
- No token-cost estimates or fabricated performance numbers.
