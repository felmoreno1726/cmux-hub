# AI explanations

## Goal

Build on cmux-hub's live diff viewer with plain-English summaries, file explanations,
and a comparison with the last reviewed diff. Keep the original project history and
license. Keep the AI code separate so upstream changes remain easy to merge.

## Completion criteria

- The viewer explains the exact diff on screen, including a selected commit.
- Readers can choose a file, detail level, and their installed model provider.
- Changes make prior answers visibly stale. Refreshing Git never calls a model.
- A review checkpoint supports a before/after explanation within the open page.
- Requests are bounded, cached, and tested without paid model calls.
- The fork builds and can be opened locally.

## Status

Implemented on `feat/ai-explanations` in the separate cmux-hub fork. The old
Diffy checkout is unchanged. The AI code connects to the existing app through
one request endpoint and one React panel.

## Checks

- 184 unit and server tests pass, including caching, duplicate requests,
  retries, input limits, source separation, sampling, and request protection.
- 9 browser tests pass, including the original viewer checks and the new
  file selector, detail controls, review checkpoints, stale answers, and retry.
- Type checking, lint, formatting, and the standalone build pass.
- Real Claude and Codex calls both returned explanations for a small test patch.
- Wide and narrow layouts were inspected.

Run `bun test src server`, `bun run test:e2e`, `bun run typecheck`,
`bun run lint`, `bun run fmt:check`, and `bun run build:compile`.
Browser tests need Playwright's Chromium installed with
`bunx playwright install chromium --only-shell`.

## Limits

Review points and browser answers stay in memory until the page reloads or
closes. Server answers last until the process stops, with a limit of 100 entries.
Each request has a two-minute deadline. One model call runs at a time.
Patches above two million characters are rejected with a suggestion to select a
single file. Smaller patches are sampled when they exceed the chosen detail
level's context budget, from 4,000 to 120,000 characters. Comparisons split that
budget between the previous and current patch.

The comparison explains two snapshots of the displayed patch. It is not a Git
commit or a saved copy of the repository. File selection is explicit. Scrolling
does not select files or trigger model calls.

No fork release has been published. Build from source for now. The updater uses
this fork's releases so it cannot silently replace the AI version with upstream.

## Next action

Use the local build for review. Publish the feature branch after the user's
approval, as required for outward-facing changes by the global AGENTS.md.
