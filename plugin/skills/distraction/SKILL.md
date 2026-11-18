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

The game pauses when the turn you are waiting for finishes or when an agent needs input. **Keep playing** dismisses the interruption. Finished turns are available under recent chats. Questions and approvals stay in the input queue until they resolve or you clear them from the game.

On macOS, open an entry to return to its Codex Desktop chat or the originating iTerm pane for Claude Code or Codex CLI. If the pane is gone or the terminal cannot select a specific pane, the button can bring the app forward. The plugin remembers recent return locations locally for up to seven days. If you reopen the arcade after closing it, use `open.sh` to restart the return listener.

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

Reports send the state and reason, agent label, checksum of the session ID, opaque event ID, timestamps, and return target type. A random token generated on the machine pairs the browser and plugin. Chat titles and contents, file paths, tool input, and the actual Codex chat or terminal pane IDs stay on the machine.

The macOS listener reads the status endpoint while the arcade is connected so it can respond when you open a chat from the game.
