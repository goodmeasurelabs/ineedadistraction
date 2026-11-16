#!/bin/sh
# Open the paired arcade. The pairing token travels in the URL fragment, which
# browsers never send to a server or put in a referrer.
#   open.sh               open and print the link
#   open.sh --background  same, quietly (used by the hooks)
#   open.sh --print       only print the link
#   open.sh --resurface   quietly bring the pop-up forward, opening it if it is
#                         closed; does nothing where there is no pop-up
# With a Chromium browser installed the game opens as a small pop-up window of
# its own, sized to sit beside a terminal. On macOS that window belongs to a
# separate browser instance (profile in the state directory, "browser"), and a
# later call brings the same window back to the front rather than opening
# another. Otherwise, or if the file "no-popup" exists in the state directory,
# it opens as a normal tab.
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
umask 077
mkdir -p "$DIR" || exit 1
if [ ! -s "$DIR/token" ]; then od -An -N16 -tx1 /dev/urandom | tr -d ' \n' > "$DIR/token"; fi
URL="$BASE/agent#t=$(cat "$DIR/token")"

case "$1" in
  --print) echo "$URL"; exit 0 ;;
  --background) QUIET=1 ;;
  --resurface) QUIET=1; RESURFACE=1 ;;
  *) QUIET=0 ;;
esac

POPUP_ARGS="--app=$URL&popup --window-size=460,800"
if [ ! -f "$DIR/no-popup" ] && [ "$(uname)" = "Darwin" ]; then
  # The pop-up runs in a browser instance of its own, with its profile kept in
  # the state directory. A browser that is already running ignores the window
  # flags and opens the pop-up behind other apps; a separate instance honours
  # them, and it has only this one window, so bringing it forward can never
  # raise some other browser window instead.
  PROFILE="$DIR/browser"
  RAISE="$(dirname "$0")/raise.js"
  popup_pid() {
    ps -axo pid=,command= | grep -F -- "--user-data-dir=$PROFILE" | grep -v -e '--type=' -e 'grep -F' \
      | awk '{print $1; exit}'
  }
  # One pop-up, not one per call: if it is already open, resurface it.
  PID=$(popup_pid)
  if [ -n "$PID" ] && [ "$(osascript -l JavaScript "$RAISE" front "$PID" 2>/dev/null)" = ok ]; then
    [ "$QUIET" = 1 ] || echo "$URL"; exit 0
  fi
  PLACE=$(osascript -l JavaScript "$RAISE" place 2>/dev/null)
  for APP in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
    if [ -d "/Applications/$APP.app" ] || [ -d "$HOME/Applications/$APP.app" ]; then
      if open -na "$APP" --args "--user-data-dir=$PROFILE" --no-first-run --no-default-browser-check \
           "--app=$URL&popup" --window-size=460,800 ${PLACE:+"--window-position=$PLACE"}; then
        # A new instance comes up in front by itself. One that was left running
        # with its window closed does not, so make sure either way.
        ( sleep 1; PID=$(popup_pid); [ -n "$PID" ] && osascript -l JavaScript "$RAISE" front "$PID" wait ) >/dev/null 2>&1 &
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

# A tab cannot be found again, so resurfacing must not open one each time.
[ "$RESURFACE" = 1 ] && exit 0

if command -v open >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  if [ "$QUIET" = 1 ]; then open -g "$URL"; else open "$URL"; fi
elif command -v wslview >/dev/null 2>&1; then wslview "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1
else QUIET=0; echo "Could not find a browser opener. Open this link yourself:"
fi
[ "$QUIET" = 1 ] || echo "$URL"
exit 0
