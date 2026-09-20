#!/usr/bin/env bash
# Check out the `data` branch into ./data (creating it as an orphan on first run).
set -euo pipefail
git config --global user.name "popdex-bot"
git config --global user.email "popdex-bot@users.noreply.github.com"
if git ls-remote --exit-code --heads origin data >/dev/null 2>&1; then
  git fetch -q --depth 1 origin data
  git worktree add -q data origin/data
  git -C data checkout -q -B data origin/data
else
  echo "data branch missing -> creating orphan"
  mkdir data
  git -C data init -q -b data
  git -C data remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  echo "# PopDex Minor Insights — data branch (auto-generated, do not edit)" > data/README.md
  git -C data add -A && git -C data commit -q -m "init data branch" && git -C data push -q origin data
fi
echo "data branch ready: $(ls data | wc -l) entries"
