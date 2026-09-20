#!/usr/bin/env bash
# Run the PopDex collectors on any Linux box you already have, with GNU screen
# instead of systemd (no root needed). Same layout as deploy/oracle:
#   $BASE/code            main branch (collector code)
#   $BASE/data-snapshot   data branch clone for the snapshot writer
#   $BASE/data-listener   data branch clone for the listener writer
#
#   bash screen.sh install   # clone + venv (needs: git, python3 -m venv, screen; and push access to the repo)
#   bash screen.sh start     # start both collectors in detached screen sessions
#   bash screen.sh status    # what is running + last log lines
#   bash screen.sh stop
#
# Push access: the server's SSH key must be on GitHub (your account key, or a
# repo deploy key with write access). Override the clone URL with REPO_URL.
set -euo pipefail
BASE="${BASE:-$HOME/popdex}"
REPO_URL="${REPO_URL:-git@github.com:eferbarn/PopDex_Minor_Insights.git}"
cmd="${1:-status}"

install() {
  mkdir -p "$BASE"; cd "$BASE"
  [ -d code ] || git clone -q "$REPO_URL" code
  for d in data-snapshot data-listener; do
    [ -d "$d" ] || git clone -q -b data --single-branch "$REPO_URL" "$d"
    git -C "$d" config user.name popdex-bot; git -C "$d" config user.email popdex-bot@users.noreply.github.com
  done
  [ -d venv ] || python3 -m venv venv
  venv/bin/pip install -q --upgrade pip; venv/bin/pip install -q -r code/collector/requirements.txt
  mkdir -p logs
  echo "installed in $BASE"
}

start() {
  cd "$BASE"
  screen -list | grep -q popdex-listener || screen -dmS popdex-listener -L -Logfile "$BASE/logs/listener.log" bash -c \
    "cd $BASE/code; while true; do DATA_DIR=$BASE/data-listener PUBLISH=1 WHALE_USD=25000 COMMIT_EVERY=600 PYTHONUNBUFFERED=1 $BASE/venv/bin/python collector/listener.py --seconds 0; sleep 10; done"
  screen -list | grep -q popdex-snapshot || screen -dmS popdex-snapshot -L -Logfile "$BASE/logs/snapshot.log" bash -c \
    "cd $BASE/code; while true; do
       old=\$(git rev-parse HEAD); git pull -q --ff-only origin main || true
       if [ \"\$old\" != \"\$(git rev-parse HEAD)\" ]; then $BASE/venv/bin/pip install -q -r collector/requirements.txt; screen -S popdex-listener -X quit || true; sleep 2; bash $BASE/code/deploy/screen/screen.sh start; fi
       DATA_DIR=$BASE/data-snapshot PUBLISH=1 PYTHONUNBUFFERED=1 $BASE/venv/bin/python collector/snapshot.py
       sleep 600
     done"
  status
}

stop() { for s in popdex-listener popdex-snapshot; do screen -S "$s" -X quit 2>/dev/null && echo "stopped $s" || true; done; }

status() {
  screen -list 2>/dev/null | grep popdex || echo "nothing running"
  for f in "$BASE"/logs/*.log; do [ -f "$f" ] && { echo "--- $(basename "$f")"; tail -n 5 "$f"; }; done
}

case "$cmd" in install) install ;; start) start ;; stop) stop ;; status) status ;; restart) stop; start ;; *) echo "usage: $0 install|start|stop|restart|status"; exit 1 ;; esac
