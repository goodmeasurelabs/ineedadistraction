#!/bin/sh
# Open the paired arcade. The pairing token travels in the URL fragment, which
# browsers never send to a server or put in a referrer.
#   open.sh               open and print the link
#   open.sh --background  same, quietly (used by the hooks)
#   open.sh --print       only print the link
# With a Chromium browser installed the game opens as a small pop-up window of
# its own, sized to sit beside a terminal. Otherwise, or if the file "no-popup"
# exists in the state directory, it opens as a normal tab.
DIR="${INAD_HOME:-$HOME/.config/ineedadistraction}"
BASE="${INAD_URL:-https://www.ineedadistraction.com}"
umask 077
mkdir -p "$DIR" || exit 1
if [ ! -s "$DIR/token" ]; then od -An -N16 -tx1 /dev/urandom | tr -d ' \n' > "$DIR/token"; fi
URL="$BASE/agent#t=$(cat "$DIR/token")"

case "$1" in
  --print) echo "$URL"; exit 0 ;;
  --background) QUIET=1 ;;
  *) QUIET=0 ;;
esac

POPUP_ARGS="--app=$URL&popup --window-size=460,800"
if [ ! -f "$DIR/no-popup" ] && [ "$(uname)" = "Darwin" ]; then
  for APP in "Google Chrome" "Brave Browser" "Microsoft Edge" "Chromium"; do
    if [ -d "/Applications/$APP.app" ] || [ -d "$HOME/Applications/$APP.app" ]; then
      # shellcheck disable=SC2086
      open -na "$APP" --args $POPUP_ARGS && { [ "$QUIET" = 1 ] || echo "$URL"; exit 0; }
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

if command -v open >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  if [ "$QUIET" = 1 ]; then open -g "$URL"; else open "$URL"; fi
elif command -v wslview >/dev/null 2>&1; then wslview "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1
else QUIET=0; echo "Could not find a browser opener. Open this link yourself:"
fi
[ "$QUIET" = 1 ] || echo "$URL"
exit 0
