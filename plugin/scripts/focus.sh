#!/bin/sh
# Bring this agent's app back to the front (macOS only).
# Called by wait.sh when the user clicks "Back to your agent" in the game.
# Codex Desktop's hook process identifies itself with
# CODEX_INTERNAL_ORIGINATOR_OVERRIDE, but does not inherit the terminal's
# __CFBundleIdentifier. Check that explicit host before any stale terminal
# variables inherited when the desktop app was launched from a shell.
# Terminal agents use:
#   __CFBundleIdentifier  which app the terminal is (set by macOS)
#   ITERM_SESSION_ID      which iTerm tab and pane, so that one is selected
# In other terminals the app comes forward on whichever tab it last showed.
[ "$(uname)" = "Darwin" ] || exit 0

if [ "$CODEX_INTERNAL_ORIGINATOR_OVERRIDE" = "Codex Desktop" ]; then
  open -b com.openai.codex 2>/dev/null
  exit 0
fi

if [ "$TERM_PROGRAM" = "iTerm.app" ]; then
  ID=${ITERM_SESSION_ID#*:}
  case "$ID" in ''|*[!A-Fa-f0-9-]*) ID="" ;; esac
  if [ -n "$ID" ]; then
    DONE=$(osascript - "$ID" 2>/dev/null <<'APPLESCRIPT'
on run argv
  set target to item 1 of argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if (id of s as text) is target then
            tell w to select
            tell t to select
            tell s to select
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "none"
end run
APPLESCRIPT
)
    [ "$DONE" = ok ] && exit 0
  fi
fi

case "$__CFBundleIdentifier" in ''|*[!A-Za-z0-9.-]*) exit 0 ;; esac
open -b "$__CFBundleIdentifier" 2>/dev/null
exit 0
