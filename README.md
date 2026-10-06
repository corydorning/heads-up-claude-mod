# heads-up-claude-mod

A mod for [Claude Code](https://claude.com/claude-code): a plugin written as function hooks that adds live UI and behavior to a session.

## Heads Up

Keeps one list of everything that needs you, shown as a bar above the prompt:

```
⚑ 1 blocking · 4 need you · 2 questions · 1 failure · 1 note
```

Click the bar (or run `/headsup`) to open the list.

**What lands on the list**

| Kind | How |
|---|---|
| Questions | Claude logs them when it asks you something. *Blocking* ones (Claude can't continue until you answer) sort first. If Claude ends a turn on a question it forgot to log, the mod logs it anyway. |
| Follow-ups | Things Claude tells you to do that it can't do itself (restart a server, review before merging). |
| Failures | Any tool call that errors or that you deny. Harmless noise is skipped: a search or check that exits 1 with no error output, like `grep` finding nothing. The item closes itself when the same command later succeeds. |
| Notes | Your own, with `/todo <text>`. |

**Answering**

- Every question and follow-up has a reply box under it. Type your answer and press Enter (or click **Send**).
- Your reply goes to the Claude session that asked, even if you're looking at the list from a different session.
- Once Claude has acted on your reply, the item disappears from the list.
- **Go** takes you to the session an item came from, so you can read the full conversation.
- Questions and follow-ups stay until they're answered.
- Notes have a ✓ to check them off. Failures have **Close** to clear them, and **Go** to jump to the session where they happened.
- On the mobile app, which has no reply boxes, an **Answer** button puts the question in your prompt instead.

**Shared**: all your Claude Code sessions on the same computer share one list. Each item shows when it was raised and which project folder it came from. `/headsup clear` clears everything from the current session.

## Install

### Every session on your machine

```bash
git clone https://github.com/corydorning/heads-up-claude-mod ~/.claude/mods
```

Then add the mod's folder to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/headsup",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

New sessions load it. `CLAUDE_CODE_PLUGIN_DIR_WATCH` makes desktop-app sessions reload the mod when its files change (after a `git pull`, say); without it, a session keeps the version it started with. To try it in one session only: `claude --plugin-dir ~/.claude/mods/headsup`.

### Remote (cloud) sessions

Remote sessions can't see your machine, so the cloud environment has to fetch the mod. Add this to your environment's setup script:

```bash
git clone --depth 1 https://github.com/corydorning/heads-up-claude-mod /tmp/heads-up-claude-mod
mkdir -p ~/.claude/skills && cp -R /tmp/heads-up-claude-mod/headsup ~/.claude/skills/headsup
```

Each remote session keeps its own list; it isn't synced with your machine.

## Develop

```bash
claude plugin validate headsup
claude plugin test headsup
```

`headsup/DESIGN.md` explains how it works. The plugin API is early access and may change between Claude Code releases.

## License

[MIT](LICENSE)
