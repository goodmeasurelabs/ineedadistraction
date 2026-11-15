#!/bin/sh
# I Need a Distraction: report the coding agent's state so the game can pause
# the moment the agent needs its human.
#
#   state.sh working prompt  <agent>   user sent a prompt, agent is busy
#   state.sh waiting done    <agent>   agent finished its turn
#   state.sh waiting permission|question <agent>   agent is blocked on the user
#   state.sh resume  -       <agent>   a tool ran: if we were blocked, we are busy again
#   state.sh idle    end     <agent>   session closed
#
# What leaves this machine: the state word, the reason word, the agent label and
# a random pairing token. Never prompts, file paths, code or tool input.
# This script must never block or break the agent: it always exits 0, prints
# nothing (except "{}" for stop hooks, which some agents require), and does its
# network call in the background.

STATE="$1"; REASON="$2"; AGENT="${3:-agent}"
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)

# Hook input arrives as JSON on stdin. We only look for the session id (to open
# the game at most once per session) and the tool name (see "resume" below).
INPUT=""
if [ ! -t 0 ]; then INPUT=$(cat 2>/dev/null); fi
field() { printf '%s' "$INPUT" | tr -d '\n' | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1; }

finish() { [ "$REASON" = "done" ] && printf '{}'; exit 0; }

[ -f "$DIR/off" ] && finish
case "$STATE" in working|waiting|idle|resume) ;; *) finish ;; esac

umask 077
mkdir -p "$DIR" 2>/dev/null || finish
if [ ! -s "$DIR/token" ]; then
  od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' > "$DIR/token"
  [ -s "$DIR/token" ] || finish
fi

LAST=$(cat "$DIR/last" 2>/dev/null)
if [ "$STATE" = "resume" ]; then
  # Only meaningful right after a permission prompt or a question was answered.
  case "$LAST" in "waiting permission"*|"waiting question"*) ;; *) finish ;; esac
  # The question tool reports its own "waiting"; its pre-tool event is not a resume.
  [ "$(field hook_event_name)" = "PreToolUse" ] && [ "$(field tool_name)" = "AskUserQuestion" ] && finish
  STATE="working"; REASON="prompt"
fi

# Skip exact repeats so chatty events cost nothing.
[ "$LAST" = "$STATE $REASON $AGENT" ] && finish
printf '%s %s %s' "$STATE" "$REASON" "$AGENT" > "$DIR/last"
SESSION=$(field session_id)

(
  # One sender at a time, and each sends whatever the newest state is by then,
  # so reports can never land out of order.
  n=0
  while ! mkdir "$DIR/lock" 2>/dev/null; do
    n=$((n + 1)); [ "$n" -gt 40 ] && rm -rf "$DIR/lock"; sleep 0.1
  done
  trap 'rmdir "$DIR/lock" 2>/dev/null' EXIT
  set -- $(cat "$DIR/last" 2>/dev/null)
  TOKEN=$(cat "$DIR/token")
  REPLY=$(curl -fsS -m 5 -X POST -H 'Content-Type: application/json' \
    -d "{\"state\":\"$1\",\"reason\":\"$2\",\"agent\":\"$3\"}" "$BASE/api/agent/$TOKEN" 2>/dev/null)
  # First prompt of a session with no game tab open: open one quietly, once.
  if [ "$1" = "working" ] && [ ! -f "$DIR/no-auto-open" ] && [ -n "$SESSION" ] \
     && [ "$(cat "$DIR/opened-for" 2>/dev/null)" != "$SESSION" ]; then
    case "$REPLY" in *'"attached":false'*)
      printf '%s' "$SESSION" > "$DIR/opened-for"
      sh "$HERE/open.sh" --background ;;
    esac
  fi
) </dev/null >/dev/null 2>&1 &

finish
