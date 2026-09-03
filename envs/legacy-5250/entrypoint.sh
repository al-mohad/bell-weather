#!/bin/sh
# Brings up the display, the terminal emulator and the application, then blocks.
set -e

STATE_DIR=/var/lib/simapp
mkdir -p "$STATE_DIR"
rm -f "$STATE_DIR/fault" "$STATE_DIR/state.json" "$STATE_DIR/screen.txt"

Xvfb :99 -screen 0 800x480x24 -nolisten tcp >/dev/null 2>&1 &

i=0
until xdpyinfo -display :99 >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 200 ] || { echo "Xvfb did not start" >&2; exit 1; }
  sleep 0.05
done

# xterm ignores synthetic events unless this is set, and xdotool needs it whenever a
# window is addressed directly rather than through the pointer.
printf 'xterm*allowSendEvents: true\n' | xrdb -display :99 -merge

xterm -display :99 \
      -geometry 80x24+0+0 \
      -fn 10x20 -b 0 -bw 0 \
      -bg black -fg green \
      -xrm 'xterm*allowSendEvents: true' \
      -e /usr/local/bin/northwind5250.py >/dev/null 2>&1 &

i=0
until [ -f "$STATE_DIR/state.json" ]; do
  i=$((i + 1))
  [ "$i" -lt 400 ] || { echo "the application did not start" >&2; exit 1; }
  sleep 0.05
done

# No window manager, so X uses PointerRoot focus: keyboard events go to the window
# under the pointer. Park the pointer inside the (fullscreen) terminal once.
xdotool mousemove 400 240

echo "northwind5250 ready on :99 (800x480, 10x20 cells)"
exec tail -f /dev/null
