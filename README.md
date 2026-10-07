# Heads Up

A mod for [Claude Code](https://claude.com/claude-code) that keeps one list of everything waiting on you, shown as a bar above the prompt:

```
⚑ 1 blocking · 4 need you · 2 questions · 1 failure · 1 note
```

Click the bar to open the list. Answer Claude's questions right there, even ones asked in another session.

## What shows up

| Kind | Where it comes from |
|---|---|
| **Questions** | Claude adds them when it asks you something. Ones that block Claude's work are marked *blocking* and listed first. |
| **Follow-ups** | Things Claude tells you to do that it can't do itself, like restarting a server or reviewing before merging. |
| **Failures** | Commands and tool calls that fail or that you deny. Harmless ones, like a search that finds nothing, are skipped. A failure clears itself when the same command later succeeds. |
| **Notes** | Your own reminders, added with `/todo <text>`. |

Each item shows when it was raised (`Today, 5:42 PM`) and, if it came from another session, which project folder.

## Using the list

- **Reply:** questions and follow-ups have a reply box. Type your answer and press Enter or click **Send**. The reply goes to the session that asked, and the item disappears once Claude has acted on it.
- **Go:** jumps to the session an item came from, so you can read the full conversation.
- **✓:** checks off a note.
- **Close:** clears a failure.

Questions and follow-ups stay on the list until they're answered.

## Commands

| Command | What it does |
|---|---|
| `/headsup` | Opens the list. |
| `/headsup clear` | Clears everything from the current session. |
| `/todo <text>` | Adds a note. |

## Install

### On your computer

1. Download the mod:

   ```bash
   git clone https://github.com/corydorning/heads-up-claude-mod ~/.claude/mods
   ```

2. Add these lines to `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/headsup",
       "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
     }
   }
   ```

3. Start a new Claude Code session. The bar appears as soon as something needs you.

All sessions on the same computer share one list. To get updates, run `git pull` in `~/.claude/mods`; open sessions pick up the change automatically.

### In remote (cloud) sessions

Remote sessions can't see your computer, so add this to your cloud environment's setup script:

```bash
git clone --depth 1 https://github.com/corydorning/heads-up-claude-mod /tmp/heads-up-claude-mod
mkdir -p ~/.claude/skills && cp -R /tmp/heads-up-claude-mod/headsup ~/.claude/skills/headsup
```

Each remote session keeps its own list, separate from your computer's. **Go** only works in the desktop app.

## Notes

- Claude Code's plugin API is in early access and may change between releases.
- The mobile app has no reply boxes, so there an **Answer** button puts the question in your prompt instead.

## Develop

```bash
claude plugin validate headsup
claude plugin test headsup
```

[`headsup/DESIGN.md`](headsup/DESIGN.md) explains how it works.

## License

[MIT](LICENSE)
