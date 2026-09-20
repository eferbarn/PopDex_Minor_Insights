#!/usr/bin/env bash
# One-shot installer for the PopDex collectors on a fresh Ubuntu VM
# (tested target: Oracle Cloud Always-Free VM.Standard.E2.1.Micro, Ubuntu 22.04/24.04).
#
#   curl -fsSL https://raw.githubusercontent.com/eferbarn/PopDex_Minor_Insights/main/deploy/oracle/setup.sh | bash
#
# What it does:
#   1. installs git + python3-venv
#   2. creates /opt/popdex with a deploy key (prints the public key; you add it to
#      GitHub as a deploy key with WRITE access, then press Enter)
#   3. clones main (code) and two copies of the data branch (one per writer)
#   4. installs systemd units: popdex-listener (always on) and popdex-snapshot (every 10 min)
set -euo pipefail

REPO="eferbarn/PopDex_Minor_Insights"
BASE="/opt/popdex"
RUN_USER="${SUDO_USER:-$USER}"

echo "== 1/4 packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3 python3-venv python3-pip >/dev/null

echo "== 2/4 deploy key"
sudo mkdir -p "$BASE" && sudo chown "$RUN_USER" "$BASE"
mkdir -p "$BASE/.ssh" && chmod 700 "$BASE/.ssh"
KEY="$BASE/.ssh/id_ed25519"
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "popdex-collector@$(hostname)" -f "$KEY"
ssh-keyscan -t ed25519 github.com 2>/dev/null > "$BASE/.ssh/known_hosts"
export GIT_SSH_COMMAND="ssh -i $KEY -o UserKnownHostsFile=$BASE/.ssh/known_hosts -o IdentitiesOnly=yes"
echo
echo "------------------------------------------------------------------"
echo "Add this as a DEPLOY KEY with 'Allow write access' at"
echo "  https://github.com/$REPO/settings/keys/new"
echo
cat "$KEY.pub"
echo "------------------------------------------------------------------"
if [ -t 0 ]; then read -r -p "Press Enter once the key is added... "; else
  echo "(non-interactive: waiting until the key works)"; until git ls-remote -q "git@github.com:$REPO.git" >/dev/null 2>&1; do sleep 10; done; fi

echo "== 3/4 clones"
cd "$BASE"
[ -d code ] || git clone -q "git@github.com:$REPO.git" code
for d in data-snapshot data-listener; do
  [ -d "$d" ] || git clone -q -b data --single-branch "git@github.com:$REPO.git" "$d" 2>/dev/null || {
    echo "data branch does not exist yet -> creating it"
    git init -q -b data "$d"; git -C "$d" remote add origin "git@github.com:$REPO.git"
    echo "# PopDex Minor Insights — data branch (auto-generated)" > "$d/README.md"
    git -C "$d" add -A; git -C "$d" -c user.name=popdex-bot -c user.email=popdex-bot@users.noreply.github.com commit -qm "init data branch"
    git -C "$d" push -q origin data; }
  git -C "$d" config user.name popdex-bot
  git -C "$d" config user.email popdex-bot@users.noreply.github.com
  git -C "$d" config core.sshCommand "$GIT_SSH_COMMAND"
done
git -C code config core.sshCommand "$GIT_SSH_COMMAND"
python3 -m venv "$BASE/venv"
"$BASE/venv/bin/pip" install -q --upgrade pip
"$BASE/venv/bin/pip" install -q -r "$BASE/code/collector/requirements.txt"

echo "== 4/4 systemd"
sudo cp "$BASE/code/deploy/oracle/popdex-listener.service" "$BASE/code/deploy/oracle/popdex-snapshot.service" "$BASE/code/deploy/oracle/popdex-snapshot.timer" "$BASE/code/deploy/oracle/popdex-update.service" "$BASE/code/deploy/oracle/popdex-update.timer" /etc/systemd/system/
sudo sed -i "s/__USER__/$RUN_USER/g" /etc/systemd/system/popdex-*.service
sudo systemctl daemon-reload
sudo systemctl enable --now popdex-listener.service popdex-snapshot.timer popdex-update.timer
echo
echo "done. useful commands:"
echo "  systemctl status popdex-listener        # is the websocket listener up?"
echo "  journalctl -u popdex-listener -f        # live log"
echo "  systemctl list-timers popdex-*          # next snapshot / code update"
echo "  journalctl -u popdex-snapshot -n 50     # last snapshot run"
