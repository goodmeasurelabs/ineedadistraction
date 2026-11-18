#!/bin/sh
# Select a return target on the hook's machine and activate it on macOS.
#   focus.sh --target <session_id>     capture the current hook's route locally
#   focus.sh --open <type> <id> <app>  activate a previously captured route
# Codex Desktop's hook process identifies itself with
# CODEX_INTERNAL_ORIGINATOR_OVERRIDE, but does not inherit the terminal's
# __CFBundleIdentifier. Check that explicit host before any stale terminal
# variables inherited when the desktop app was launched from a shell.
# Terminal agents use:
#   __CFBundleIdentifier  which app the terminal is (set by macOS)
#   ITERM_SESSION_ID      which iTerm tab and pane, so that one is selected
# In other terminals the app comes forward on whichever tab it last showed.
is_uuid() {
  case "$1" in ''|*[!0-9A-Fa-f-]*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Exq '[[:xdigit:]]{8}(-[[:xdigit:]]{4}){3}-[[:xdigit:]]{12}'
}

is_bundle() {
  case "$1" in ''|[!A-Za-z0-9]*|*[!A-Za-z0-9.-]*) return 1 ;; esac
}

capture_target() {
  if [ "$(uname)" != "Darwin" ]; then
    printf 'unavailable - -\n'
  elif [ "$CODEX_INTERNAL_ORIGINATOR_OVERRIDE" = "Codex Desktop" ]; then
    if is_uuid "$1"; then
      printf 'chat %s com.openai.codex\n' "$1"
    else
      printf 'app - com.openai.codex\n'
    fi
  elif [ "$TERM_PROGRAM" = "iTerm.app" ] && is_uuid "${ITERM_SESSION_ID#*:}"; then
    printf 'pane %s com.googlecode.iterm2\n' "${ITERM_SESSION_ID#*:}"
  elif is_bundle "$__CFBundleIdentifier"; then
    printf 'app - %s\n' "$__CFBundleIdentifier"
  else
    printf 'unavailable - -\n'
  fi
}

open_target() {
  [ "$(uname)" = "Darwin" ] || return 0
  case "$1" in
    chat)
      [ "$3" = com.openai.codex ] && is_uuid "$2" || return 0
      open -b com.openai.codex "codex://threads/$2" 2>/dev/null && return 0
      ;;
    pane)
      [ "$3" = com.googlecode.iterm2 ] && is_uuid "$2" || return 0
      DONE=$(osascript - "$2" 2>/dev/null <<'APPLESCRIPT'
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
      [ "$DONE" = ok ] && return 0
      ;;
    app) ;;
    *) return 0 ;;
  esac
  if is_bundle "$3"; then open -b "$3" 2>/dev/null; fi
}

case "$1" in
  --target) capture_target "$2" ;;
  --open) open_target "$2" "$3" "$4" ;;
  *) open_target $(capture_target) ;;
esac
exit 0
