#!/bin/sh
# While an agent session waits on its human, listen for the game's "Back to
# your agent" button and bring this session's terminal to the front (focus.sh).
#   wait.sh <session checksum>
# Started in the background by state.sh each time a session starts waiting. It
# ends when the session stops waiting, when a newer listener replaces it, or
# after 30 minutes. It only reads the same status the game page reads; nothing
# new leaves this machine. macOS only; the file "no-return" in the state
# directory turns it off.
SID="$1"
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
[ -n "$SID" ] && [ "$(uname)" = "Darwin" ] || exit 0
[ -f "$DIR/off" ] || [ -f "$DIR/no-return" ] && exit 0
TOKEN=$(cat "$DIR/token" 2>/dev/null)
[ -n "$TOKEN" ] || exit 0

umask 077
printf '%s' "$$" > "$DIR/wait.$SID" 2>/dev/null || exit 0
mine() { [ "$(cat "$DIR/wait.$SID" 2>/dev/null)" = "$$" ]; }
trap 'mine && rm -f "$DIR/wait.$SID"' 0
trap 'exit 0' 1 2 15

number() { printf '%s' "$REPLY" | grep -o "\"$1\":[0-9]*" | head -n 1 | cut -d: -f2; }
SEQ=""; SEEN=""
END=$(( $(date +%s) + 1800 ))
while [ "$(date +%s)" -lt "$END" ] && mine; do
  case "$(cat "$DIR/run.$SID" 2>/dev/null)" in waiting*) ;; *) exit 0 ;; esac
  # A long poll: with seq it returns when anything changes, or after ~20s.
  # peek=1 keeps this from counting as an open game tab.
  REPLY=$(curl -fsS -m 28 "$BASE/api/agent/$TOKEN?peek=1${SEQ:+&seq=$SEQ}" 2>/dev/null)
  SEQ=$(number seq); AT=$(number focusAt)
  # No answer: the network is down, try again shortly. An answer without
  # focusAt: this server does not know the button, so there is nothing to hear.
  if [ -z "$SEQ" ]; then sleep 10; continue; fi
  [ -n "$AT" ] || exit 0
  # The first answer only tells us where we start; act on requests after it.
  if [ -n "$SEEN" ] && [ "$AT" != "$SEEN" ]; then
    FOR=$(printf '%s' "$REPLY" | grep -o '"focusRun":"[^"]*"' | head -n 1 | cut -d'"' -f4)
    [ "$FOR" = "$SID" ] && sh "$HERE/focus.sh"
  fi
  SEEN="$AT"
done
exit 0
