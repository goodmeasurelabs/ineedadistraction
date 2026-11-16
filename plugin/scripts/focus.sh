#!/bin/sh
# Bring the terminal this agent runs in back to the front (macOS only).
# Called by wait.sh when the user clicks "Back to your agent" in the game. It
# relies on the environment the agent's hooks inherit from the terminal:
#   __CFBundleIdentifier  which app the terminal is (set by macOS)
#   ITERM_SESSION_ID      which iTerm tab and pane, so that one is selected
# In other terminals the app comes forward on whichever tab it last showed.
[ "$(uname)" = "Darwin" ] || exit 0

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
