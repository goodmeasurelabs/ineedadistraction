#!/bin/sh
# Open the paired arcade in the default browser. The pairing token travels in
# the URL fragment, which browsers never send to a server or put in a referrer.
#   open.sh               open in front and print the link
#   open.sh --background  open without taking focus (used by the hooks)
#   open.sh --print       only print the link
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

if command -v open >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  if [ "$QUIET" = 1 ]; then open -g "$URL"; else open "$URL"; fi
elif command -v wslview >/dev/null 2>&1; then wslview "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$URL" >/dev/null 2>&1
else QUIET=0; echo "Could not find a browser opener. Open this link yourself:"
fi
[ "$QUIET" = 1 ] || echo "$URL"
exit 0
