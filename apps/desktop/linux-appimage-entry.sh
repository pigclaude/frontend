#!/bin/sh
# 从 FUSE 挂载目录启动 Electron，由 Chromium 选择系统沙箱。
set -eu

app_dir=${APPDIR:-$(dirname -- "$(readlink -f -- "$0")")}
export PATH="$app_dir:$app_dir/usr/sbin${PATH:+:$PATH}"
export XDG_DATA_DIRS="$app_dir/usr/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}:/usr/share/gnome:/usr/local/share:/usr/share/"
export LD_LIBRARY_PATH="$app_dir/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GSETTINGS_SCHEMA_DIR="$app_dir/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:$GSETTINGS_SCHEMA_DIR}"

if [ -z "${APPIMAGE_EXIT_AFTER_INSTALL:-}" ]; then
  exec "$app_dir/pigclaude" "$@"
fi
