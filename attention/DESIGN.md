# attention

Tracks open items that need the user's attention inside Claude Code, shared across sessions.

## Items
`{ id, kind, text, detail?, session, folder, createdAt, status, doneAt?, fingerprint? }` (see `types/index.d.ts`).
Kinds: `question`, `followup`, `failure`, `note`.

Stored in `$.store` under `items` (shared by every session running the mod) and mirrored into
`$.state` (`attention.items`) so the band and pane redraw on change. Every write re-reads the store
first, so other sessions' changes are kept. The mirror refreshes on each turn start and every 30s.
Done items are pruned after 7 days; the list is capped at 200 (done items dropped first).

## Sources
- **question / followup**: (questions may be `blocking`: Claude cannot continue until answered) Claude calls `mcp__attention__attention` (`add` / `resolve` / `list`),
  told when to by a system prompt section added in `prompt.compose`. Backstop: when a main-loop turn ends
  on a question (last paragraph, `hooks/questions.ts`) and Claude logged nothing that turn, it is logged.
- **failure**: any tool call that errors or is denied. One open item per session + call fingerprint;
  the same call succeeding later closes it. Shell noise is skipped (`hooks/noise.ts`): exit code 1, every
  step a search/check (grep, rg, which, test, diff, ...), and no error wording in the output.
- **note**: `/todo <text>`.

## Display
- Band above the prompt: `⚑ N need you · counts by kind`, led by an accent `⚑ N blocking` segment when any
  question blocks Claude; every part is a plain Button that opens the pane. Hidden when nothing is open.
- Pane (`/attention` or a click on the band): grouped by kind, blocking first then newest. Questions and
  follow-ups have only `Answer` (never dismissed; Claude closes them after acting on the reply); notes and
  failures have ✓. `Answer` opens an autofocused reply field (state `attention.answering`); Enter sends
  `Re: "<item>" [<id>]\n<reply>` with `$.prompt.submit`. On mobile (no Input) it closes the pane and then
  fills the prompt box, which refuses text while a pane holds the keys
  (fills the prompt with `Re: "<question>" [<id>]`, which Claude resolves after acting on it), `Show done` toggle,
  other sessions' items tagged with their folder.
- Toasts for new questions and failures.
- `/attention clear` marks this session's open items done.

## Files
- `hooks/items.ts`: pure list logic (no `$`).
- `hooks/questions.ts`: the question a reply ends on (no `$`).
- `hooks/noise.ts`: which shell failures are harmless (no `$`).
- `hooks/register.tsx`: hooks, tool, commands, UI, store sync (`$` may not cross an import).
- `tests/`: unit tests for `items.ts` and engine tests via `claude plugin test`.

## Loading
Lives in `~/.claude/mods/attention`; `~/.claude/settings.json` names it in `env.CLAUDE_CODE_PLUGIN_DIRS`,
so every new session loads it.
