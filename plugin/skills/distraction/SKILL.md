---
name: distraction
description: Opens a game from ineedadistraction.com for the user to play while you work; the game pauses by itself when you finish or need them. Use when the user asks for a distraction, a game, or something to do while waiting, or wants to open, pause, turn off or troubleshoot the game sync.
---

# I Need a Distraction

The user plays a browser game while you work. Hooks installed with this plugin tell the game page whether you are working or waiting, so it pauses the instant you finish a turn, ask a question or need a permission, and resumes when they answer.

The scripts live in this plugin's `scripts/` folder, two levels above this file.

## Open the game

Run `sh <plugin>/scripts/open.sh`. It opens the paired arcade in the browser and prints the link. Then keep working; do not wait for the user to play.

If no browser can be opened (remote shell, container), run `open.sh --print` and give the user the link.

## Controls

State lives in `~/.config/ineedadistraction/`.

| The user wants | Do this |
|---|---|
| Stop the game opening by itself each session | `touch ~/.config/ineedadistraction/no-auto-open` |
| Let it open by itself again | `rm ~/.config/ineedadistraction/no-auto-open` |
| Turn the sync off completely | `touch ~/.config/ineedadistraction/off` |
| Turn it back on | `rm ~/.config/ineedadistraction/off` |
| Unpair this machine | `rm ~/.config/ineedadistraction/token` (the next open pairs afresh) |

## If the game does not pause or resume

1. Check that the hooks are active: `/hooks` in Codex (plugin hooks must be reviewed and trusted once), `/hooks` in Claude Code.
2. Run `sh <plugin>/scripts/state.sh working prompt test` then `cat ~/.config/ineedadistraction/last`; it should read `working prompt test`.
3. Confirm the machine can reach `https://www.ineedadistraction.com`.

## What is sent

Only four things: the word `working`, `waiting` or `idle`; a one-word reason (`prompt`, `done`, `permission`, `question`, `end`); which agent it is; and a random pairing token made on this machine. Never prompts, file paths, code or tool input.
