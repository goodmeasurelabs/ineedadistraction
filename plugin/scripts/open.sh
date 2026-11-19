#!/bin/sh
# Open the paired arcade. The pairing token travels in the URL fragment, which
# browsers never send to a server or put in a referrer.
#   open.sh               open and print the link
#   open.sh --background  quiet first-prompt launch outside macOS
#   open.sh --print       only print the link
#   open.sh --resurface <origin bundle> [first]
#     On macOS show the popup only while the prompting app has focus.
#     "first" also allows a background-tab fallback for that session.
# With a Chromium browser installed the game opens as a small pop-up window of
# its own, sized to sit beside a terminal. On macOS that window belongs to a
# separate browser instance (profile in the state directory, "browser"), and a
# later call brings the same window back to the front rather than opening
# another. Otherwise, or if the file "no-popup" exists in the state directory,
# it opens as a normal tab.
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
umask 077
mkdir -p "$DIR" || exit 1
if [ ! -s "$DIR/token" ]; then od -An -N16 -tx1 /dev/urandom | tr -d ' \n' > "$DIR/token"; fi
URL="$BASE/arcade#t=$(cat "$DIR/token")"

case "$1" in
  --print) echo "$URL"; exit 0 ;;
  --background) QUIET=1 ;;
  --resurface) QUIET=1; RESURFACE=1; ORIGIN="$2"; FIRST="$3" ;;
  *) QUIET=0 ;;
esac

# Explicit opens may show the saved Off screen; automatic opens must respect
# durable local settings before raising any browser window.
if command -v python3 >/dev/null 2>&1; then
  python3 "$HERE/settings.py" local >/dev/null 2>&1
  : > "$DIR/settings-wake"
  (exec nohup python3 "$HERE/settings.py" listen) </dev/null >/dev/null 2>&1 &
fi
automatic_off() { [ -f "$DIR/off" ] || [ -f "$DIR/no-auto-open" ]; }
[ "$QUIET" = 1 ] && automatic_off && exit 0

SYSTEM=$(uname)
if [ "$SYSTEM" = "Darwin" ] && [ ! -f "$DIR/off" ] && [ ! -f "$DIR/no-return" ]; then
  (exec nohup sh "$(dirname "$0")/state.sh" --listen) </dev/null >/dev/null 2>&1 &
fi

POPUP_ARGS="--app=$URL&popup --window-size=460,800"
RAISE="$HERE/raise.js"
mac_launch_allowed() {
  [ "$QUIET" != 1 ] || { [ "$RESURFACE" = 1 ] && ! automatic_off &&
    [ "$(osascript -l JavaScript "$RAISE" eligible "$ORIGIN" 2>/dev/null)" = ok ]; }
}
if [ "$SYSTEM" = "Darwin" ] && [ "$QUIET" = 1 ]; then
  [ "$RESURFACE" = 1 ] && [ -n "$ORIGIN" ] || exit 0
fi
if [ ! -f "$DIR/no-popup" ] && [ "$SYSTEM" = "Darwin" ]; then
  # The pop-up runs in a browser instance of its own, with its profile kept in
  # the state directory. A browser that is already running ignores the window
  # flags and opens the pop-up behind other apps; a separate instance honours
  # them, and it has only this one window, so bringing it forward can never
  # raise some other browser window instead.
  PROFILE="$DIR/browser"
  popup_pid() {
    ps -axo pid=,command= | awk -v profile=" --user-data-dir=$PROFILE " '
      /^[[:space:]]*[0-9]+[[:space:]]+\/.*\/Contents\/MacOS\/(Google Chrome|Brave Browser|Microsoft Edge|Chromium) / &&
      index($0 " ", profile) && !index($0, " --type=") {print $1; exit}'
  }
  raise_popup() {
    if [ "$QUIET" = 1 ]; then
      automatic_off && return
      osascript -l JavaScript "$RAISE" front "$1" "$2" "$ORIGIN" "$DIR" 2>/dev/null
    else
      osascript -l JavaScript "$RAISE" front "$1" "$2" 2>/dev/null
    fi
  }
  # One pop-up, not one per call: if it is already open, resurface it.
  PID=$(popup_pid)
  if [ -n "$PID" ] && [ "$(raise_popup "$PID" now)" != none ]; then
    [ "$QUIET" = 1 ] || echo "$URL"; exit 0
  fi
  PLACE=$(osascript -l JavaScript "$RAISE" place 2>/dev/null)
  for APP in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
    if [ -d "/Applications/$APP.app" ] || [ -d "$HOME/Applications/$APP.app" ]; then
      mac_launch_allowed || exit 0
      # A cold launch can outlive the prompt. Launch it behind the user's
      # current app and recheck the origin when the new window is ready.
      if [ "$QUIET" = 1 ]; then set -- -g -na; else set -- -na; fi
      if open "$@" "$APP" --args "--user-data-dir=$PROFILE" --no-first-run --no-default-browser-check \
           "--app=$URL&popup" --window-size=460,800 ${PLACE:+"--window-position=$PLACE"}; then
        # A new instance comes up in front by itself. One that was left running
        # with its window closed does not, so make sure either way.
        (
          sleep 1
          PID=$(popup_pid)
          [ -n "$PID" ] && raise_popup "$PID" wait
        ) >/dev/null 2>&1 &
        [ "$QUIET" = 1 ] || echo "$URL"; exit 0
      fi
    fi
  done
elif [ ! -f "$DIR/no-popup" ] && [ -z "$WSL_DISTRO_NAME" ]; then
  for BIN in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$BIN" >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      "$BIN" $POPUP_ARGS >/dev/null 2>&1 &
      [ "$QUIET" = 1 ] || echo "$URL"; exit 0
    fi
  done
fi

# A normal tab has no dedicated window. Open it in the background on the
# session's first eligible prompt and leave it alone on later prompts.
if [ "$RESURFACE" = 1 ]; then
  [ "$SYSTEM" = Darwin ] && [ "$FIRST" = first ] && mac_launch_allowed || exit 0
fi

if command -v open >/dev/null 2>&1 && [ "$SYSTEM" = "Darwin" ]; then
  if [ "$QUIET" = 1 ]; then open -g "$URL"; else open "$URL"; fi
elif command -v wslview >/dev/null 2>&1; then wslview "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1
else QUIET=0; echo "Could not find a browser opener. Open this link yourself:"
fi
[ "$QUIET" = 1 ] || echo "$URL"
exit 0
