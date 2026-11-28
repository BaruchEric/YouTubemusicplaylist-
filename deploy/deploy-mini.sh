#!/usr/bin/env bash
# Deploys this checkout to macmini-2018, where cratesync.service serves it at
# https://music.beric.ca through the beric-mini tunnel, behind the beric.ca edge gate.
#
# It copies the committed tree, installs and builds on the mini, installs the unit,
# restarts it, and checks that the server answers with the build it just made.
# The tunnel rule and the DNS record are set up once, in the homelab repo
# (services/tunnels). See docs/DEPLOY.md.
#
# Usage: bun run deploy            deploy HEAD (refuses a dirty tree)
#        MINI_HOST=macmini-ts ...  pin the ssh alias
set -euo pipefail
cd "$(dirname "$0")/.."

DEST=/opt/stacks/cratesync
PORT=4420
UNIT=cratesync.service

# Main became a Kotlin Multiplatform project in 9e95771 and no longer holds the
# Bun web app. The rsync below runs with --delete before anything is built, so
# copying that tree would remove server.ts on the mini, and music.beric.ca would
# go down at the next restart of the unit.
if [ ! -f server.ts ] || [ ! -f bun.lock ]; then
  echo "This tree has no Bun web app (server.ts and bun.lock), so this script has nothing to deploy." >&2
  echo "music.beric.ca keeps serving the last web build. docs/DEPLOY.md says how to redeploy it." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes. Commit them first, so what runs is a commit." >&2
  exit 1
fi
REV=$(git rev-parse --short HEAD)

HOST=""
for candidate in ${MINI_HOST:-macmini-ip macmini macmini-ts}; do
  if ssh -o ConnectTimeout=4 -o BatchMode=yes "$candidate" true 2>/dev/null; then
    HOST=$candidate
    break
  fi
done
if [ -z "$HOST" ]; then
  echo "macmini-2018 does not answer on any ssh alias." >&2
  exit 1
fi
echo "Deploying $REV to $HOST:$DEST"

ssh "$HOST" "mkdir -p $DEST/app"
# .env files stay local: the mini reads its secrets from $DEST/env.
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude coverage \
  --exclude .impeccable --include .env.example --exclude '.env*' \
  ./ "$HOST:$DEST/app/"

ssh "$HOST" REV="$REV" DEST="$DEST" PORT="$PORT" UNIT="$UNIT" 'bash -s' <<'REMOTE'
set -euo pipefail
export PATH=/home/eric/.local/share/mise/shims:/home/eric/.local/bin:$PATH
cd "$DEST/app"
bun install --frozen-lockfile
bun run build
echo "$REV" > "$DEST/DEPLOYED"

sudo install -m 644 deploy/cratesync.service "/etc/systemd/system/$UNIT"
sudo systemctl daemon-reload
sudo systemctl enable "$UNIT" >/dev/null 2>&1
sudo systemctl restart "$UNIT"

for _ in $(seq 1 20); do
  # Quiet on purpose: the first tries land before the server is listening.
  if curl -fs -o /tmp/cratesync-index.html "http://127.0.0.1:$PORT/"; then
    break
  fi
  sleep 1
done
if ! cmp -s /tmp/cratesync-index.html dist/index.html; then
  echo "The server on 127.0.0.1:$PORT does not answer with the page this build made." >&2
  sudo systemctl status "$UNIT" --no-pager | tail -15 >&2
  exit 1
fi
rm -f /tmp/cratesync-index.html
echo "cratesync.service is active and serves build $REV on 127.0.0.1:$PORT"
REMOTE
