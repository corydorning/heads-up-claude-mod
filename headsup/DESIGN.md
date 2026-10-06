# Heads Up (`headsup`)

Tracks open items that need the user's attention inside Claude Code, shared across sessions.

## Items
`{ id, kind, text, detail?, session, folder, createdAt, status, doneAt?, fingerprint? }` (see `types/index.d.ts`).
Kinds: `question`, `followup`, `failure`, `note`.

Stored in `$.store` under `items` (shared by every session running the mod) and mirrored into
`$.state` (`headsup.items`) so the band and pane redraw on change. Every write re-reads the store
first, so other sessions' changes are kept. The mirror refreshes on each turn start and every 30s.
Done items are pruned after 7 days; the list is capped at 200 (done items dropped first).

## Sources
- **question / followup**: (questions may be `blocking`: Claude cannot continue until answered) Claude calls `mcp__headsup__headsup` (`add` / `resolve` / `list`),
  told when to by a system prompt section added in `prompt.compose`. Backstop: when a main-loop turn ends
  on a question (last paragraph, `hooks/questions.ts`) and Claude logged nothing that turn, it is logged.
- **failure**: any tool call that errors or is denied. One open item per session + call fingerprint;
  the same call succeeding later closes it. Shell noise is skipped (`hooks/noise.ts`): exit code 1, every
  step a search/check (grep, rg, which, test, diff, ...), and no error wording in the output.
- **note**: `/todo <text>`.

## Display
- Band above the prompt: `⚑ N need you · counts by kind`, led by an accent `⚑ N blocking` segment when any
  question blocks Claude; every part is a plain Button that opens the pane. Hidden when nothing is open.
- Pane (`/headsup` or a click on the band; opened with `focus` so the first click lands): grouped by kind,
  blocking first then newest. Questions and follow-ups show their full detail and an always-visible reply
  Input (never dismissed; Claude closes them after acting on the reply). A reply is `Re: "<item>" [<id>]\n<reply>`:
  `$.prompt.submit` for this session's items, `$.session.send` to the item's `sessionId` for another's. The reply row is the
  Input, one `Send` button, then `Go` for items logged with a desktop app link, which runs `open <link>` (`claude://claude.ai/epitaxy/<host id>`,
  from `CLAUDE_CODE_HOST_SESSION_ID` at log time). Notes and failures have ✓. On mobile (no Input) `Answer`
  closes the pane and fills the prompt box instead.
- Toasts for new questions and failures.
- `/headsup clear` marks this session's open items done.

## Files
- `hooks/items.ts`: pure list logic (no `$`).
- `hooks/questions.ts`: the question a reply ends on (no `$`).
- `hooks/noise.ts`: which shell failures are harmless (no `$`).
- `hooks/register.tsx`: hooks, tool, commands, UI, store sync (`$` may not cross an import).
- `tests/`: unit tests for `items.ts` and engine tests via `claude plugin test`.

## Loading
Lives in `~/.claude/mods/headsup`; `~/.claude/settings.json` names it in `env.CLAUDE_CODE_PLUGIN_DIRS`,
so every new session loads it.
