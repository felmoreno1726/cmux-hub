# Inline AI explanations

## Goal

Keep the code at full width. Add one short explanation under each visible file's
header and a compact overall summary above the diffs. Use only + and − controls.
The user approved automatic summaries for visible files and required the code to
load independently of them.

Summaries must use the newest visible OpenAI Luna model listed by Codex and stay
easy to read. Completion requires automatic model discovery, larger summary text,
and verification that the code still loads while summaries wait.

## Behavior

- Diffs render immediately. AI requests never gate the diff view.
- Visible files get a one-sentence explanation after a 600-millisecond settling
  delay. Offscreen files wait until visible.
- Plus adds detail. Minus shortens the answer and then hides it.
- Provider settings live in environment variables, without a configuration menu.
- OpenAI through Codex is the default. The highest numbered stable `gpt-*-luna`
  model in Codex's catalog is selected. The catalog is checked on the first
  summary request and again after ten minutes when another request arrives.
  Existing cached summaries remain unchanged. Set `DIFFY_CODEX_MODEL` to pin a
  model or `DIFFY_PROVIDER=claude` to use Claude instead.
- Summary text is 15px with increased contrast. The shortest summary still uses
  at most two lines. Labels and status text are 12px and 13px.
- Matching answers are cached. Changed code dims the old summary until a new
  answer arrives. Queued requests for old or hidden diffs are skipped.
- Requests run one at a time. Errors stay in the summary row and do not hide code.
- There is no explanation sidebar, file selector, provider selector, or review
  checkpoint menu.

## Architecture

`InlineExplanation.tsx` owns visibility, detail, and request state.
`explanation-client.ts` queues and caches browser requests. `explanations.ts` on
the server calls the installed provider CLI. The upstream viewer only needs the
raw patch and an inline summary slot in each file component.
`explanation-models.ts` reads Codex's `model/list` through its app server. It
handles multiple pages and shares discovery across requests. Discovery has a
30-second deadline. Failures stay visible and can be retried with +. It never
falls back to a larger model. The selection rule and refresh behavior are covered
by `explanation-models.test.ts`.

## Verification

Run `bun test src server`, `bun run test:e2e`, `bun run typecheck`,
`bun run lint`, `bun run fmt:check`, and `bun run build:compile`.
Browser tests require Playwright Chromium. They use a fake model runner, never
real subscription calls.

The browser tests cover slow summaries, full-width diffs, per-file patches,
plus/minus controls, caching, automatic refresh, offscreen files, and retry.
The earlier implementation's real Claude and Codex smoke calls passed.

## Limits

Browser and server caches each retain at most 100 answers. A model request has a
two-minute deadline. Queued requests can be skipped; a model call already running
finishes and populates the cache. Navigation may reset the chosen detail level.
Patches above two million characters are rejected. Context budgets range from
4,000 to 120,000 characters, with a visible notice when code is omitted.

## Delivery

Work stays on the local `feat/ai-explanations` branch until approved for publishing.
The installed `cmux-hub-ai` command points to the compiled fork. No fork release
has been published. The updater targets the fork, preserving the AI additions.
