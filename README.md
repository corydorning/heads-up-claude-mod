# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins written as function hooks that add live UI and behavior to a session.

## attention

Keeps one list of everything that needs you, shown as a bar above the prompt:

```
⚑ 1 blocking · 4 need you · 2 questions · 1 failure · 1 note
```

Click the bar (or run `/attention`) to open the list.

**What lands on the list**

| Kind | How |
|---|---|
| Questions | Claude logs them when it asks you something. *Blocking* ones (Claude can't continue until you answer) sort first. If Claude ends a turn on a question it forgot to log, the mod logs it anyway. |
| Follow-ups | Things Claude tells you to do that it can't do itself (restart a server, review before merging). |
| Failures | Any tool call that errors or that you deny. Harmless noise is skipped: a search or check that exits 1 with no error output, like `grep` finding nothing. The item closes itself when the same command later succeeds. |
| Notes | Your own, with `/todo <text>`. |

**Answering**: every question and follow-up has a reply field right under it, with Claude's explanation above it. Type and press Enter (or **Send**). The reply goes to the session that asked: to Claude here if it came from this session, or as a message to that other session if not. It arrives as `Re: "<item>" [<id>]`, and Claude closes the item once it has acted on it. Items from another desktop session also have a **Go** button that switches the app to that session for the full conversation. Questions and follow-ups can't be dismissed unanswered; notes and failures have ✓. (The mobile app has no text fields, so there an **Answer** button puts the reply line in your prompt box.)

**Shared**: the list is kept across sessions on the same machine, and each item shows which folder it came from. `/attention clear` marks everything from the current session done.

## Install

### Every session on your machine

```bash
git clone https://github.com/corydorning/claude-mods ~/.claude/mods
```

Then add the mod's folder to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/attention",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

New sessions load it. `CLAUDE_CODE_PLUGIN_DIR_WATCH` makes desktop-app sessions reload the mod when its files change (after a `git pull`, say); without it, a session keeps the version it started with. To try it in one session only: `claude --plugin-dir ~/.claude/mods/attention`.

### Remote (cloud) sessions

Remote sessions can't see your machine, so the cloud environment has to fetch the mod. Add this to your environment's setup script:

```bash
git clone --depth 1 https://github.com/corydorning/claude-mods /tmp/claude-mods
mkdir -p ~/.claude/skills && cp -R /tmp/claude-mods/attention ~/.claude/skills/attention
```

Each remote session keeps its own list; it isn't synced with your machine.

## Develop

```bash
claude plugin validate attention
claude plugin test attention
```

`attention/DESIGN.md` explains how it works. The plugin API is early access and may change between Claude Code releases.

## License

[MIT](LICENSE)
