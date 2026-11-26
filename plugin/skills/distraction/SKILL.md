---
name: distraction
description: Opens and customizes I Need a Distraction while the user waits for their agent. Use for a distraction, Stop distracting, Keep distracting, game preferences, pairing, or troubleshooting the game sync.
---

# I Need a Distraction

The user plays a browser game while you work. Hooks installed with this plugin tell the game page whether you are working or waiting, so it pauses when you finish a turn, ask a question or need a permission, and resumes when they answer. Version 0.5 adds persistent on/off controls and a chosen game mix.

The scripts live in this plugin's `scripts/` folder, two levels above this file.

## Open the game

Run `sh <plugin>/scripts/open.sh`. It opens the compact player at `/arcade` and prints the paired link. `/agent` is the separate website setup page. Then keep working; do not wait for the user to play. An explicit open preserves Off; only an explicit request to turn distractions on enables them.

On macOS with a Chromium browser the game is a small pop-up window in a browser instance of its own (profile in `~/.config/ineedadistraction/browser`), so it has its own saves and sign-in. Running `open.sh` again brings that same window back to the front; it does not open a second one. When distractions are On, a fresh interactive prompt can bring the popup forward while the originating coding app or terminal is still active. Switching to another app keeps that app in front.

After updating the plugin, follow the agent client's restart or hook-review instructions, then refresh the existing popup once (Cmd+R on macOS, Ctrl+R elsewhere) to load the new controls. Opening it again only brings the existing window forward.

If no browser can be opened (remote shell, container), run `open.sh --print` and give the user the link.

## Getting back to the agent

The game pauses when the turn you are waiting for finishes or when an agent needs input. **Resume this game** dismisses that interruption only. It does not answer an agent question or change persistent settings. Finished turns are available under recent chats. Questions and approvals stay in the input queue until they resolve or you clear them from the game.

On macOS, open an entry to return to its Codex Desktop chat or the originating iTerm pane for Claude Code or Codex CLI. If the pane is gone or the terminal cannot select a specific pane, the button can bring the app forward. The plugin remembers recent return locations locally for up to seven days. If you reopen the arcade after closing it, use `open.sh` to restart the return listener.

## Controls

State lives in `~/.config/ineedadistraction/`. Use the helper below instead of editing settings files. Python 3 is required for preference synchronization. These settings apply to this paired computer, including its Codex and Claude Code sessions.

| The user wants | Do this |
|---|---|
| “Stop distracting”, “turn distractions off”, or stop automatic popups | `python3 <plugin>/scripts/settings.py off` |
| “Keep distracting” or “turn distractions on” | `python3 <plugin>/scripts/settings.py on`, then `sh <plugin>/scripts/open.sh` if they want to play now |
| “Only math games” | `python3 <plugin>/scripts/settings.py set --categories math` |
| “Puzzles and merge games” | `python3 <plugin>/scripts/settings.py set --categories merge,logic` |
| “No timers” | `python3 <plugin>/scripts/settings.py set --pace untimed` |
| “Any pace” | `python3 <plugin>/scripts/settings.py set --pace any` |
| Mute games / enable game sound | `python3 <plugin>/scripts/settings.py set --sound false` / `--sound true` |
| Show current preferences | `python3 <plugin>/scripts/settings.py show` |
| Retry synchronization | `python3 <plugin>/scripts/settings.py sync` |
| Open the game as a normal browser tab, not a pop-up | `touch ~/.config/ineedadistraction/no-popup` |
| Stop the game's button from switching to the terminal | `touch ~/.config/ineedadistraction/no-return` |

Currently playable category IDs are `merge`, `logic`, `math`, and `arcade`. `words` and `memory` are reserved for later games; do not promise playable games in those categories yet. `math` currently offers number strategy, not an arithmetic quiz. The helper can combine settings in one call:

```sh
python3 <plugin>/scripts/settings.py set --enabled true --categories merge,logic --pace untimed --sound false
```

Read the returned JSON. Local changes apply immediately. `synced: true` confirms the service acknowledged them; `pending: true` or a synchronization note means the change is saved locally and will retry. Never say the website/popup confirmed a change when synchronization failed. `sync` returns a nonzero exit status if it cannot confirm synchronization.

If an offline or retried On conflicts with a newer Stop from the popup, Off wins. Read the returned effective `settings.enabled` and note; ask for a fresh explicit request to turn it on rather than automatically retrying an old enable.

Off persists across new prompts, restarts and navigation. It stops automatic opening/resurfacing and game notifications, while the control connection and agent status remain available. Turning Off does not uninstall or unpair anything. “Resume this game” is separate from “Keep distracting.” Difficulty and family-friendly filtering are not implemented in this version; explain that if asked instead of inventing settings.

`open.sh` starts a small settings listener on supported Python 3 environments, independent of macOS return controls. The listener keeps working while distractions are Off and exits after five minutes without an attached player. Reopen using `open.sh` to restore it. `open.sh --print` only prints a link; it does not start listeners or a browser.

Old `off` and `no-auto-open` flags migrate to persistent Off. Use `settings.py on` to re-enable; removing a flag by hand does not override the saved setting. To unpair, first turn distractions Off, then remove the token and local settings only if the user explicitly asks to forget the pairing. The next explicit setup creates a fresh pairing.

## If the game does not pause or resume

1. Check that the hooks are active: `/hooks` in Codex (plugin hooks must be reviewed and trusted once), `/hooks` in Claude Code.
2. Run `sh <plugin>/scripts/state.sh working prompt test` then `cat ~/.config/ineedadistraction/last`; it should read `working prompt test`.
3. Confirm the machine can reach `https://www.ineedadistraction.com`.
4. For controls or preferences, run `python3 <plugin>/scripts/settings.py show`, then `sync`. If the popup says the plugin is unavailable, reopen it with `open.sh`; if the installed helper does not exist, update the plugin. Required hook review still applies after script updates.

Codex uses `hooks/codex.json`, declared in its plugin manifest. It pauses for `request_user_input` and `request_user_input_async` questions and Stop events. Asynchronous questions stay paused after the tool returns and while unrelated work continues. A local Python 3 helper matches structured answers to the pending question IDs using the latest 16 MB of the transcript, retaining only IDs, question counts and answered indices. The transcript format is not a stable API; if Python or the metadata is unavailable, the pause remains until a fresh user prompt.

If a finished Codex turn briefly shows up and a clip starts again, check for plugin 0.5.2 or newer. It follows prompts from identifiable user chats and keeps the completion notice in place through background work.

If another Stop hook continues the turn, the next root sampling request restores the working state; compaction and child model requests do not.

Codex's `PermissionRequest` event occurs before automatic approval review. The local helper suppresses game pauses for native shell and patch checks when the hook explicitly says don't-ask/bypass, or exact current-turn metadata identifies automatic review under an on-request policy (or a never-ask policy). Missing, stale or unfamiliar metadata keeps permission pauses. Questions and connected-app approval requests are not suppressed. This only changes game notifications, never approval decisions. Human-only command or category-policy overrides can still show Codex's native approval prompt in automatic mode without pausing the game.

## What is sent

Reports send the state and reason, agent label, checksum of the session ID, opaque event ID, timestamps, and return target type. A random token generated on the machine pairs the browser and plugin. Chat titles and contents, file paths, tool input, and the actual Codex chat or terminal pane IDs stay on the machine.

Preferences sync sends the enabled setting, category IDs, pace, sound preference, settings revision and plugin version. The control service accepts only these fixed settings, never shell commands. Setup prompts contain preferences and public instructions, never pairing tokens.

The macOS listener reads the status endpoint while the arcade is connected so it can respond when you open a chat from the game.
