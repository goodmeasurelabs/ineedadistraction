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
# Reports include state, reason, agent, opaque IDs and timestamps, pairing
# token, and return target type. The actual chat and pane IDs stay local.
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
  TOKEN="$3"; SID="$4"
  shift 4
  exec curl -fsS -m 5 --retry 2 --retry-max-time 12 --retry-connrefused \
    -X POST -H 'Content-Type: application/json' \
    -d "{\"state\":\"$1\",\"reason\":\"$2\",\"agent\":\"$3\",\"session\":\"$SID\",\"eventAt\":$4,\"eventId\":\"$5\",\"promptAt\":$6,\"returnTarget\":\"$7\"}" "$BASE/api/agent/$TOKEN" 2>/dev/null
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

acquire_lock() {
  LOCK="$1"; LIMIT="$2"
  # A generation suffix prevents a delayed cleanup from confusing reused PIDs.
  GENERATION=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
  [ -n "$GENERATION" ] || return 1
  OWNER="owner.$$.$GENERATION"
  TRIES=0
  while :; do
    TRIES=$((TRIES + 1)); [ "$TRIES" -gt "$LIMIT" ] && return 1
    if mkdir "$LOCK" 2>/dev/null; then
      if cd "$LOCK" 2>/dev/null && mkdir "$OWNER" 2>/dev/null; then
        # An empty directory may have been reclaimed between mkdir and cd.
        # Publish ownership atomically, then enter only if we are its sole owner.
        set -- owner.*
        [ "$#" -eq 1 ] && [ "$1" = "$OWNER" ] && break
        rmdir "$OWNER" 2>/dev/null
      fi
      cd "$DIR" 2>/dev/null || return 1
    else
      (cd "$LOCK" 2>/dev/null && reap_owners)
    fi
    # Also recovers a crash between mkdir and publishing the owner marker.
    # rmdir cannot remove a directory containing a live owner's marker.
    rmdir "$LOCK" 2>/dev/null
    sleep 0.1
  done
}

release_lock() {
  rmdir "$OWNER" 2>/dev/null
  reap_owners
  rmdir "$LOCK" 2>/dev/null
  cd "$DIR" 2>/dev/null
}

if [ "$STATE" = "--listen" ]; then
  DIR=$(cd "$DIR" 2>/dev/null && pwd -P) || exit 0
  INAD_HOME="$DIR"
  export INAD_HOME
  acquire_lock "$DIR/listener-lock" 2 || exit 0
  trap 'release_lock' 0
  trap 'exit 0' 1 2 15
  . "$HERE/wait.sh"
  exit 0
fi

# A new shell gives the background sender its own $$ (a plain (...) does not).
if [ "$STATE" = "--send" ]; then
  SESSION="$REASON"; SID="$3"
  DIR=$(cd "$DIR" 2>/dev/null && pwd -P) || exit 0
  INAD_HOME="$DIR"
  export INAD_HOME
  # Never pile up waiters: after 20s give up; a later event will report.
  acquire_lock "$DIR/lock" 200 || exit 0
  trap 'release_lock' 0
  trap 'exit 0' 1 2 15
  # Read the newest complete state only after acquiring the lock. Requests are
  # serialized; an orphaned curl retains its own marker until it exits.
  set -- $(cat "$DIR/run.$SID" 2>/dev/null)
  [ "$#" -ge 7 ] || exit 0
  [ "$(cat "$DIR/sent.$SID" 2>/dev/null)" != "$5" ] || exit 0
  TOKEN=$(cat "$DIR/token" 2>/dev/null)
  [ -n "$TOKEN" ] || exit 0
  REPLY=$(sh "$HERE/state.sh" --request "$OWNER" "$TOKEN" "$SID" "$1" "$2" "$3" "$4" "$5" "$6" "$7") || exit 0
  [ -n "$REPLY" ] || exit 0
  printf '%s' "$5" > "$DIR/sent.$SID.$$" && mv -f "$DIR/sent.$SID.$$" "$DIR/sent.$SID"
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
DIR=$(cd "$DIR" 2>/dev/null && pwd -P) || finish
INAD_HOME="$DIR"
export INAD_HOME

# Serialize local transitions so overlapping hooks cannot share an event time
# or replace a newer run record. The sender uses a separate network lock.
acquire_lock "$DIR/event-lock" 20 || finish
trap 'release_lock' 0
trap 'finish' 1 2 15
if [ ! -s "$DIR/token" ]; then
  od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' > "$DIR/token"
  [ -s "$DIR/token" ] || finish
fi

# Each agent session keeps its own last state, so several agents running at
# once never mask each other. The server only sees a checksum of the id.
SESSION=$(field session_id)
SID=$(printf '%s' "$SESSION" | cksum 2>/dev/null | cut -d' ' -f1)
[ -n "$SESSION" ] && [ -n "$SID" ] || SID=0
set -- $(cat "$DIR/run.$SID" 2>/dev/null)
LAST="$1 $2 $3"
LAST_EVENT_AT="${4:-0}"
PROMPT_AT="${6:-0}"
LAST_REQUEST="${10:--}"
EVENT=$(field hook_event_name)
TOOL=$(field tool_name)
QUESTIONS="$DIR/questions.$SID"
SYNC_QUESTION="$DIR/question-sync.$SID"

if [ "$EVENT" = "SessionEnd" ] && [ "$LAST" = "waiting done $AGENT" ]; then
  # Done is already idle to a queue-aware server. Keep its event intact when a
  # fast quit would otherwise replace the only copy before it gets sent.
  STATE="waiting"; REASON="done"
fi

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

# A different tool request can require attention even if this run was
# already waiting. Keep the call identity local.
REQUEST="-"
if [ "$STATE" = "waiting" ] && [ "$REASON" != "done" ]; then
  CALL=$(field tool_use_id)
  [ -n "$CALL" ] && REQUEST=$(printf '%s' "$CALL" | cksum | cut -d' ' -f1)
fi

# Keep genuine async questions visible if automation continued and reached Stop.
if [ "$STATE $REASON $AGENT" = "waiting done codex" ] && [ -d "$QUESTIONS" ]; then
  PENDING=$(python3 "$HERE/codex-context.py" pending "$QUESTIONS" "$(field transcript_path)" 2>/dev/null)
  if [ "$PENDING" != "clear" ]; then
    [ "$LAST" != "waiting question codex" ] || finish
    REASON="question"
  fi
fi

# New prompts always get new identities. Duplicate Stop and retry events
# keep the existing identity, including after a user dismissed the overlay.
if [ "$EVENT" != "UserPromptSubmit" ] && [ "$LAST" = "$STATE $REASON $AGENT" ] &&
   { [ "$REQUEST" = "-" ] || [ "$LAST_REQUEST" = "$REQUEST" ]; }; then
  release_lock
  trap - 0 1 2 15
  # This can recover a report lost to an earlier network error.
  (exec sh "$HERE/state.sh" --send "$SESSION" "$SID") </dev/null >/dev/null 2>&1 &
  finish
fi

EVENT_AT=$(python3 -c 'import time; print(time.time_ns() // 1000000)' 2>/dev/null)
case "$EVENT_AT" in ''|*[!0-9]*) EVENT_AT=$(( $(date +%s) * 1000 )) ;; esac
case "$LAST_EVENT_AT" in ''|*[!0-9]*) LAST_EVENT_AT=0 ;; esac
[ "$EVENT_AT" -gt "$LAST_EVENT_AT" ] || EVENT_AT=$((LAST_EVENT_AT + 1))
[ "$EVENT" != "UserPromptSubmit" ] || PROMPT_AT="$EVENT_AT"
EVENT_ID=$(od -An -N12 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
[ -n "$EVENT_ID" ] || finish
set -- $(sh "$HERE/focus.sh" --target "$SESSION" 2>/dev/null)
TARGET="${1:-unavailable}"
[ ! -f "$DIR/no-return" ] || TARGET="unavailable"

# Readers must see either the previous state or the complete new state.
if ! { printf '%s %s %s %s %s %s %s %s %s %s\n' \
  "$STATE" "$REASON" "$AGENT" "$EVENT_AT" "$EVENT_ID" "$PROMPT_AT" "$TARGET" "${2:--}" "${3:--}" "$REQUEST" > "$DIR/tmp.$$" &&
  mv -f "$DIR/tmp.$$" "$DIR/run.$SID" &&
  printf '%s %s %s' "$STATE" "$REASON" "$AGENT" > "$DIR/last"; } 2>/dev/null; then
  rm -f "$DIR/tmp.$$" 2>/dev/null
  finish
fi
release_lock
trap - 0 1 2 15

(
  exec sh "$HERE/state.sh" --send "$SESSION" "$SID"
) </dev/null >/dev/null 2>&1 &

# The dispatcher reads local routes for each run and outlives the originating
# app process while the browser remains attached.
if [ "$TARGET" != "unavailable" ]; then
  (
    exec nohup sh "$HERE/state.sh" --listen
  ) </dev/null >/dev/null 2>&1 &
fi

finish
