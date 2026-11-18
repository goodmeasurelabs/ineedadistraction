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

# Private request helper: exec keeps this PID alive for the whole request, even
# if the sender is killed. The inherited cwd pins the particular lock directory.
if [ "$STATE" = "--request" ]; then
  PARENT_PID=${2#owner.}
  PARENT_PID=${PARENT_PID%%.*}
  REQUEST_OWNER="owner.$$.$2"
  mkdir "$REQUEST_OWNER" 2>/dev/null || exit 0
  if [ ! -d "$2" ] || ! kill -0 "$PARENT_PID" 2>/dev/null; then
    rmdir "$REQUEST_OWNER" 2>/dev/null
    exit 0
  fi
  exec curl -fsS -m 5 -X POST -H 'Content-Type: application/json' \
    -d "{\"state\":\"$3\",\"reason\":\"$4\",\"agent\":\"$5\",\"session\":\"$7\"}" "$BASE/api/agent/$6" 2>/dev/null
  exit 0
fi

# Only remove the particular dead owner's marker, never a replacement owner's.
# Call this from inside the lock directory, so a concurrent replacement of the
# outer pathname cannot redirect cleanup into the new directory.
reap_owners() {
  for REAP_OWNER in owner.*; do
    [ -d "$REAP_OWNER" ] || continue
    REAP_PID=${REAP_OWNER#owner.}
    REAP_PID=${REAP_PID%%.*}
    case "$REAP_PID" in ''|*[!0-9]*|0) continue ;; esac
    kill -0 "$REAP_PID" 2>/dev/null || rmdir "$REAP_OWNER" 2>/dev/null
  done
}

# A new shell gives the background sender its own $$ (a plain (...) does not).
if [ "$STATE" = "--send" ]; then
  SESSION="$REASON"; SID="$3"
  DIR=$(cd "$DIR" 2>/dev/null && pwd -P) || exit 0
  INAD_HOME="$DIR"
  export INAD_HOME
  LOCK="$DIR/lock"
  # A generation suffix prevents a delayed cleanup from confusing reused PIDs.
  GENERATION=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
  [ -n "$GENERATION" ] || exit 0
  OWNER="owner.$$.$GENERATION"
  TRIES=0
  while :; do
    # Never pile up waiters: after 20s give up; a later event will report.
    TRIES=$((TRIES + 1)); [ "$TRIES" -gt 200 ] && exit 0
    if mkdir "$LOCK" 2>/dev/null; then
      if cd "$LOCK" 2>/dev/null && mkdir "$OWNER" 2>/dev/null; then
        # An empty directory may have been reclaimed between mkdir and cd.
        # Publish ownership atomically, then enter only if we are its sole owner.
        set -- owner.*
        [ "$#" -eq 1 ] && [ "$1" = "$OWNER" ] && break
        rmdir "$OWNER" 2>/dev/null
      fi
      cd "$DIR" 2>/dev/null || exit 0
    else
      (cd "$LOCK" 2>/dev/null && reap_owners)
    fi
    # Also recovers a crash between mkdir and publishing the owner marker.
    # rmdir cannot remove a directory containing a live owner's marker.
    rmdir "$LOCK" 2>/dev/null
    sleep 0.1
  done

  release_lock() {
    rmdir "$OWNER" 2>/dev/null
    reap_owners
    rmdir "$LOCK" 2>/dev/null
  }
  trap 'release_lock' 0
  trap 'exit 0' 1 2 15
  # Read the newest complete state only after acquiring the lock. Requests are
  # serialized; an orphaned curl retains its own marker until it exits.
  set -- $(cat "$DIR/run.$SID" 2>/dev/null)
  [ -n "$1" ] || exit 0
  TOKEN=$(cat "$DIR/token" 2>/dev/null)
  REPLY=$(sh "$HERE/state.sh" --request "$OWNER" "$1" "$2" "$3" "$TOKEN" "$SID")
  if [ "$1" = "idle" ]; then
    # The session is over: forget it, and any that ended without saying so.
    # Unless it came back to life while this report was in flight.
    case "$(cat "$DIR/run.$SID" 2>/dev/null)" in idle*) rm -f "$DIR/run.$SID" 2>/dev/null ;; esac
    find "$DIR" -name 'run.*' -mtime +1 -exec rm -f {} + 2>/dev/null
  fi
  OPEN=0
  if [ "$1" = "working" ] && [ ! -f "$DIR/no-auto-open" ] && [ -n "$SESSION" ] \
     && [ "$(cat "$DIR/opened-for" 2>/dev/null)" != "$SESSION" ]; then
    case "$REPLY" in *'"attached":false'*)
      printf '%s' "$SESSION" > "$DIR/opened-for"
      OPEN=1 ;;
    esac
  fi
  # Reserve the auto-open above while serialized, but launch outside the lock.
  release_lock
  trap - 0 1 2 15
  cd "$DIR" 2>/dev/null || exit 0
  [ "$OPEN" -eq 1 ] && sh "$HERE/open.sh" --background
  exit 0
fi

# Hook input arrives as JSON on stdin. We only inspect routing metadata: the
# session, event, tool and sampling kind. Never prompts or tool arguments.
INPUT=""
if [ ! -t 0 ]; then INPUT=$(cat 2>/dev/null); fi
# Take the first match: the hook's own fields come before any tool input,
# which may carry keys of the same name.
field() {
  printf '%s' "$INPUT" | tr -d '\n' | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 \
    | sed "s/^\"$1\"[[:space:]]*:[[:space:]]*\"//; s/\"\$//"
}

# One hooks file serves both agents, so work out which one is calling.
if [ "$AGENT" = "auto" ]; then
  case "$(field transcript_path)" in
    */.codex/*) AGENT="codex" ;;
    */.claude/*) AGENT="claude-code" ;;
    *) if [ -n "$PLUGIN_ROOT" ]; then AGENT="codex"; else AGENT="claude-code"; fi ;;
  esac
fi

finish() { [ "$REASON" = "done" ] && printf '{}'; exit 0; }

[ -f "$DIR/off" ] && finish
case "$STATE" in working|waiting|idle|resume) ;; *) finish ;; esac

if [ "$AGENT" = "codex" ] && [ "$STATE" = "waiting" ] && [ "$REASON" = "permission" ]; then
  # PermissionRequest precedes Codex's automatic reviewer. In automatic mode,
  # a shell/patch check is not a reason to interrupt the game. This only changes
  # our notification; Codex still makes and enforces the approval decision.
  ROUTING=$(printf '%s' "$INPUT" | python3 "$HERE/codex-context.py" approval 2>/dev/null)
  [ "$ROUTING" = "automatic" ] && finish
fi

umask 077
mkdir -p "$DIR" 2>/dev/null || finish
if [ ! -s "$DIR/token" ]; then
  od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' > "$DIR/token"
  [ -s "$DIR/token" ] || finish
fi

# Each agent session keeps its own last state, so several agents running at
# once never mask each other. The server only sees a checksum of the id.
SESSION=$(field session_id)
SID=$(printf '%s' "$SESSION" | cksum 2>/dev/null | cut -d' ' -f1)
[ -n "$SESSION" ] && [ -n "$SID" ] || SID=0
LAST=$(cat "$DIR/run.$SID" 2>/dev/null)
EVENT=$(field hook_event_name)
TOOL=$(field tool_name)
QUESTIONS="$DIR/questions.$SID"
SYNC_QUESTION="$DIR/question-sync.$SID"

if [ "$AGENT" = "codex" ]; then
  # Async questions return before the human answers. Keep only their call ids,
  # counts and answered indices locally; a tool finishing is not an answer.
  if [ "$EVENT" = "UserPromptSubmit" ] || [ "$STATE" = "idle" ]; then
    rm -rf "$QUESTIONS" 2>/dev/null
    rm -f "$SYNC_QUESTION" 2>/dev/null
  elif [ "$EVENT" = "PreToolUse" ] && [ "$TOOL" = "request_user_input" ] &&
       [ "$STATE" = "waiting" ] && [ "$REASON" = "question" ]; then
    touch "$SYNC_QUESTION" 2>/dev/null
  elif [ "$EVENT" = "PreToolUse" ] && [ "$TOOL" = "request_user_input_async" ] &&
       [ "$STATE" = "waiting" ] && [ "$REASON" = "question" ]; then
    mkdir -p "$QUESTIONS" 2>/dev/null
    if ! printf '%s' "$INPUT" | python3 "$HERE/codex-context.py" register "$QUESTIONS" 2>/dev/null; then
      # Unknown metadata must not make us hide a real question.
      touch "$QUESTIONS/unknown" 2>/dev/null
    fi
  fi
fi

# The user just sent a prompt: put the game in front of them now, before the
# report below and whatever the server says. Only on macOS, where the game is
# one pop-up window that open.sh can find and bring forward; elsewhere it opens
# once per session, after the report (see --send).
if [ "$STATE" = "working" ] && [ "$(uname)" = "Darwin" ] && [ ! -f "$DIR/no-auto-open" ]; then
  (
    exec sh "$HERE/open.sh" --resurface
  ) </dev/null >/dev/null 2>&1 &
fi
if [ "$STATE" = "resume" ]; then
  # Question and generic pre-tool hooks run concurrently. Do not undo a
  # question's waiting state before the question has even been shown.
  if [ "$EVENT" = "PreToolUse" ]; then
    case "$TOOL" in AskUserQuestion|request_user_input|request_user_input_async) finish ;; esac
  fi
  if [ "$AGENT" = "codex" ] && [ -f "$SYNC_QUESTION" ]; then
    [ "$EVENT" = "PostToolUse" ] && [ "$TOOL" = "request_user_input" ] || finish
    rm -f "$SYNC_QUESTION" 2>/dev/null
  fi
  if [ "$EVENT" = "PreModelRequest" ]; then
    # A Codex Stop hook may continue the same turn without UserPromptSubmit.
    # Only root sampling proves that its apparent completion was temporary:
    # child agents and background/foreground compaction are separate work.
    [ "$AGENT" = "codex" ] && [ "$(field kind)" = "sampling" ] &&
      [ -z "$(field agent_id)" ] && [ -n "$SESSION" ] || finish
    THREAD=$(field thread_id)
    [ -z "$THREAD" ] || [ "$THREAD" = "$SESSION" ] || finish
    case "$LAST" in
      "waiting done codex") ;;
      "waiting question codex") [ -d "$QUESTIONS" ] || finish ;;
      *) finish ;;
    esac
  else
    # Tool events resume after an answered permission prompt or question.
    case "$LAST" in "waiting permission"*|"waiting question"*) ;; *) finish ;; esac
    if [ "$LAST" = "waiting question codex" ] && [ ! -d "$QUESTIONS" ]; then
      # Only the blocking question's own completion proves it was answered.
      [ "$EVENT" = "PostToolUse" ] && [ "$TOOL" = "request_user_input" ] || finish
    fi
  fi
  if [ "$AGENT" = "codex" ] && [ -d "$QUESTIONS" ]; then
    PENDING=$(python3 "$HERE/codex-context.py" pending "$QUESTIONS" "$(field transcript_path)" 2>/dev/null)
    [ "$PENDING" = "clear" ] || finish
  fi
  STATE="working"; REASON="prompt"
fi

# Always report new prompts, including after a restart or a lost working update.
if [ "$EVENT" != "UserPromptSubmit" ] && [ "$LAST" = "$STATE $REASON $AGENT" ]; then
  finish
fi
# Readers must see either the previous state or the complete new state.
if ! { printf '%s %s %s' "$STATE" "$REASON" "$AGENT" > "$DIR/tmp.$$" &&
  cp "$DIR/tmp.$$" "$DIR/last" && mv -f "$DIR/tmp.$$" "$DIR/run.$SID"; } 2>/dev/null; then
  rm -f "$DIR/tmp.$$" 2>/dev/null
  finish
fi

(
  exec sh "$HERE/state.sh" --send "$SESSION" "$SID"
) </dev/null >/dev/null 2>&1 &

# While this session waits, listen for the game's "Back to your agent" button.
# Started from here, not from the sender, so it inherits the terminal's
# environment, which says which window and tab to bring forward.
if [ "$STATE" = "waiting" ] && [ "$(uname)" = "Darwin" ]; then
  (
    exec sh "$HERE/wait.sh" "$SID"
  ) </dev/null >/dev/null 2>&1 &
fi

finish
