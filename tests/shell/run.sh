#!/bin/bash
# Runs the extension in a separate GNOME Shell with its own settings/data dirs,
# so the real session, real dconf and real ~/.local are never touched.
#   run.sh <scenario>   headless scripted check; prints result.json
#   run.sh --devkit     visible test window for poking by hand
set -u
cd "$(dirname "$0")/../.."
ROOT="${DW_TEST_ROOT:-${TMPDIR:-/tmp}/desk-widgets-test}"
KEEP="${DW_KEEP:-0}"
[ "$KEEP" = 1 ] || rm -rf "$ROOT"
mkdir -p "$ROOT"/{config,data,cache,out}
export XDG_CONFIG_HOME="$ROOT/config" XDG_DATA_HOME="$ROOT/data" XDG_CACHE_HOME="$ROOT/cache"
make -s install DEST="$XDG_DATA_HOME/gnome-shell/extensions/desk-widgets@nisarg-gandhi.github.io" APPS="$XDG_DATA_HOME/applications" SELFTEST=1 >/dev/null || exit 2
EXTS="${DW_EXTS:-['ding@rastersoft.com','desk-widgets@nisarg-gandhi.github.io']}"
SETUP="gsettings set org.gnome.shell disable-user-extensions false; gsettings set org.gnome.shell enabled-extensions \"$EXTS\"; gsettings set org.gnome.desktop.interface color-scheme ${DW_SCHEME:-prefer-dark}; ${DW_SETUP:-true}"
if [ "${1:-}" = "--devkit" ]; then
    exec dbus-run-session -- bash -c "$SETUP; exec gnome-shell --devkit"
fi
export DW_SELFTEST="$1" DW_SELFTEST_OUT="$ROOT/out"
rm -f "$ROOT/out/result.json"
timeout "${DW_TIMEOUT:-60}" dbus-run-session -- bash -c "$SETUP; exec gnome-shell --headless --virtual-monitor ${DW_MONITOR:-1536x960} --wayland-display dw-test-$$ --no-x11" >"$ROOT/out/shell.log" 2>&1
echo "shell exit=$?"
cat "$ROOT/out/result.json" 2>/dev/null || echo "NO RESULT"
echo; echo "--- errors ---"
grep -E "JS ERROR|Extension desk-widgets|desk-widgets:" -A4 "$ROOT/out/shell.log" | sed -E 's#file://[^ ]*desk-widgets@nisarg-gandhi.github.io/##g' | cut -c1-200 | head -"${DW_ERRLINES:-25}"
