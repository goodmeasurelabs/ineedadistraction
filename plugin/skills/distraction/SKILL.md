---
name: distraction
description: Opens a game from ineedadistraction.com for the user to play while you work; the game pauses by itself when you finish or need them. Use when the user asks for a distraction, a game, or something to do while waiting, or wants to open, pause, turn off or troubleshoot the game sync.
---

# I Need a Distraction

The user plays a browser game while you work. Hooks installed with this plugin tell the game page whether you are working or waiting, so it pauses the instant you finish a turn, ask a question or need a permission, and resumes when they answer.

The scripts live in this plugin's `scripts/` folder, two levels above this file.

## Open the game

Run `sh <plugin>/scripts/open.sh`. It opens the paired arcade in the browser and prints the link. Then keep working; do not wait for the user to play.

On macOS with a Chromium browser the game is a small pop-up window in a browser instance of its own (profile in `~/.config/ineedadistraction/browser`), so it has its own saves and sign-in. Running `open.sh` again brings that same window back to the front; it does not open a second one. The hooks do the same each time the user sends a prompt, so the game is in front as soon as the agent starts working.

If no browser can be opened (remote shell, container), run `open.sh --print` and give the user the link.

## Getting back to the agent

When the agent finishes or needs the user, the paused game shows a "Back to Claude Code" (or Codex) button. Clicking it brings Codex Desktop to the front when the agent runs there. For Claude Code or Codex CLI, it brings the terminal to the front; in iTerm it also selects the tab that agent is running in. If several agents are waiting, it goes to the one that stopped most recently. This works on macOS, for up to 30 minutes after the agent stops.

## Controls

State lives in `~/.config/ineedadistraction/`.

| The user wants | Do this |
|---|---|
| Stop the game opening or coming forward by itself | `touch ~/.config/ineedadistraction/no-auto-open` |
| Let it open and come forward by itself again | `rm ~/.config/ineedadistraction/no-auto-open` |
| Turn the sync off completely | `touch ~/.config/ineedadistraction/off` |
| Turn it back on | `rm ~/.config/ineedadistraction/off` |
| Open the game as a normal browser tab, not a pop-up | `touch ~/.config/ineedadistraction/no-popup` |
| Stop the game's button from switching to the terminal | `touch ~/.config/ineedadistraction/no-return` |
| Unpair this machine | `rm ~/.config/ineedadistraction/token` (the next open pairs afresh) |

## If the game does not pause or resume

1. Check that the hooks are active: `/hooks` in Codex (plugin hooks must be reviewed and trusted once), `/hooks` in Claude Code.
2. Run `sh <plugin>/scripts/state.sh working prompt test` then `cat ~/.config/ineedadistraction/last`; it should read `working prompt test`.
3. Confirm the machine can reach `https://www.ineedadistraction.com`.

Codex uses `hooks/codex.json`, declared in its plugin manifest. It pauses for `request_user_input` and `request_user_input_async` questions and Stop events. Asynchronous questions stay paused after the tool returns and while unrelated work continues. A local Python 3 helper matches structured answers to the pending question IDs using the latest 16 MB of the transcript, retaining only IDs, question counts and answered indices. The transcript format is not a stable API; if Python or the metadata is unavailable, the pause remains until a fresh user prompt.

If another Stop hook continues the turn, the next root sampling request restores the working state; compaction and child model requests do not.

Codex's `PermissionRequest` event occurs before automatic approval review. The local helper suppresses game pauses for native shell and patch checks when the hook explicitly says don't-ask/bypass, or exact current-turn metadata identifies automatic review under an on-request policy (or a never-ask policy). Missing, stale or unfamiliar metadata keeps permission pauses. Questions and connected-app approval requests are not suppressed. This only changes game notifications, never approval decisions. Human-only command or category-policy overrides can still show Codex's native approval prompt in automatic mode without pausing the game.

## What is sent

Only five things: the word `working`, `waiting` or `idle`; a one-word reason (`prompt`, `done`, `permission`, `question`, `end`); which agent it is; a checksum of the session id (so several agents can be told apart); and a random pairing token made on this machine. Never prompts, file paths, code or tool input.

While an agent waits, the plugin also reads the same status the game page reads, to hear the "Back to" button. That sends nothing beyond the pairing token.
