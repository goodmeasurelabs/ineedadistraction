#!/bin/sh
# A single macOS listener serves all recent local routes under this pairing.
# state.sh owns the listener lock and runs this detached from Codex or
# Claude Code. The same browser tab can stay paired when those apps restart.
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
[ "$(uname)" = "Darwin" ] || exit 0
[ -f "$DIR/off" ] || [ -f "$DIR/no-return" ] && exit 0
TOKEN=$(cat "$DIR/token" 2>/dev/null)
[ -n "$TOKEN" ] || exit 0

umask 077
# Older installs use one listener per waiting session. Removing the markers
# asks those listeners to stop without touching anyone's running agent.
for marker in "$DIR"/wait.*; do
  case "${marker##*.}" in ''|*[!0-9]*) continue ;; esac
  rm -f "$marker" 2>/dev/null
done
find "$DIR" -maxdepth 1 \( -name 'run.*' -o -name 'sent.*' \) -type f -mtime +7 -exec rm -f {} + 2>/dev/null

number() { printf '%s' "$REPLY" | grep -o "\"$1\":[0-9]*" | head -n 1 | cut -d: -f2; }
stopped() {
  [ -f "$DIR/off" ] || [ -f "$DIR/no-return" ] ||
    [ "$(cat "$DIR/token" 2>/dev/null)" != "$TOKEN" ] || [ ! -f "$HERE/focus.sh" ]
}

retry_reports() {
  for run_file in "$DIR"/run.*; do
    [ -f "$run_file" ] || continue
    sid=${run_file##*.}
    case "$sid" in ''|*[!0-9]*) continue ;; esac
    read -r retry_state retry_reason retry_agent retry_time retry_id rest < "$run_file" 2>/dev/null || continue
    case "$retry_time" in ''|*[!0-9]*) continue ;; esac
    [ "$retry_time" -ge "$(((NOW - 7 * 24 * 60 * 60) * 1000))" ] || continue
    [ "$(cat "$DIR/sent.$sid" 2>/dev/null)" != "$retry_id" ] || continue
    (exec sh "$HERE/state.sh" --send '' "$sid") </dev/null >/dev/null 2>&1 &
  done
}

SEQ=""
SEEN=$(cat "$DIR/focus-seen" 2>/dev/null)
case "$SEEN" in ''|*[!0-9]*) SEEN=0 ;; esac
LAST_ATTACHED=$(date +%s)
LAST_RETRY=0
while ! stopped; do
  REPLY=$(curl -fsS -m 28 "$BASE/api/agent/$TOKEN?peek=1${SEQ:+&seq=$SEQ}" 2>/dev/null)
  stopped && exit 0
  NOW=$(date +%s)
  case "$REPLY" in *'"attached":true'*) LAST_ATTACHED="$NOW" ;; esac
  [ "$((NOW - LAST_ATTACHED))" -lt 300 ] || exit 0
  if [ "$((NOW - LAST_RETRY))" -ge 30 ]; then
    LAST_RETRY="$NOW"
    retry_reports
  fi
  SEQ=$(number seq)
  AT=$(number focusAt)
  if [ -z "$SEQ" ] || [ "$SEQ" = 0 ]; then sleep 5; continue; fi
  [ -n "$AT" ] || exit 0
  [ "$AT" -gt "$SEEN" ] || continue
  SEEN="$AT"
  # Remember a request before activating a window, including across reloads.
  printf '%s' "$SEEN" > "$DIR/focus-seen.$$" && mv -f "$DIR/focus-seen.$$" "$DIR/focus-seen"
  # A listener starting just after the button is clicked can still handle it.
  # An older request must not unexpectedly activate an app on restart.
  [ "$AT" -ge "$(((NOW - 15) * 1000))" ] || continue
  SID=$(printf '%s' "$REPLY" | grep -o '"focusRun":"[0-9]*"' | head -n 1 | cut -d'"' -f4)
  [ -n "$SID" ] || continue
  read -r state reason agent event_at event_id prompt_at target locator bundle request < "$DIR/run.$SID" 2>/dev/null || continue
  case "$event_at" in ''|*[!0-9]*) continue ;; esac
  [ "$event_at" -ge "$(((NOW - 7 * 24 * 60 * 60) * 1000))" ] || continue
  sh "$HERE/focus.sh" --open "$target" "$locator" "$bundle"
done
exit 0
