# Deploying CrateSync

CrateSync runs at https://music.beric.ca. The server is `cratesync.service` on macmini-2018, listening on `127.0.0.1:4420`. The `beric-mini` Cloudflare tunnel carries the hostname to that port, and the beric.ca edge gate asks for a sign-in before any request reaches it.

The library stays in each browser. The server holds no user data: it serves the built app and the two AI endpoints.

## Deploy a new version

```bash
bun run deploy
```

`deploy/deploy-mini.sh` refuses a dirty tree, so what runs is always a commit. It copies the tree to `/opt/stacks/cratesync/app` on the mini, runs `bun install --frozen-lockfile` and `bun run build` there, installs `deploy/cratesync.service`, restarts it, and fails unless `127.0.0.1:4420` answers with the page that build made. The deployed commit is in `/opt/stacks/cratesync/DEPLOYED`.

Run the ship gates first (`bun run lint`, `bun test`, `bun run build`). The script does not.

A deploy replaces the scripts under `dist/assets`, whose names carry a hash of their contents. A tab that was open before the deploy keeps working: it fetched every screen's script 1.5 seconds after it loaded. A tab that still asks for an old script gets a `404` and reloads itself once, which brings the new build. `docs/ARCHITECTURE.md` has the details under "How the client code is split".

## What lives on the mini

| Path | What it is |
| --- | --- |
| `/opt/stacks/cratesync/app` | The copied tree and its `dist/`. Overwritten by every deploy. |
| `/opt/stacks/cratesync/env` | `GEMINI_API_KEY` and `GEMINI_ALLOWED_EMAILS`, mode 600. Never copied from this repo and never overwritten by a deploy. Without it the AI endpoints answer 503 and the rest works. |
| `/etc/systemd/system/cratesync.service` | The unit, installed from `deploy/cratesync.service`. |

```bash
ssh macmini-ts 'systemctl status cratesync --no-pager | head -5; cat /opt/stacks/cratesync/DEPLOYED'
ssh macmini-ts 'journalctl -u cratesync -n 50 --no-pager'
```

## What makes the hostname work

These were set once, on 2026-11-26. A new hostname needs all of them again.

1. **Tunnel rule.** `music.beric.ca` to `http://localhost:4420` in `services/tunnels/mini/config.yml` in the homelab repo, copied to `/opt/stacks/tunnel/config.yml` on the mini, then a restart of `beric-mini-tunnel`.
2. **DNS.** `bun run tunnel route beric-mini music.beric.ca` in `services/tunnels` of the homelab repo.
3. **Edge gate.** Every `*.beric.ca` host is behind the gate without any setup. The entry in `services/beric-gate/edge/hosts.ts` only names the box on the gate's offline page.
4. **Google sign-in.** The Firebase project `gen-lang-client-0484635733` has to know the origin in three places, or the Drive sign-in fails:
   - Authentication, Settings, Authorized domains: `music.beric.ca`
   - the browser API key's HTTP referrers: `https://music.beric.ca/*`
   - the reCAPTCHA Enterprise key that App Check uses: `music.beric.ca`
5. **YouTube.** Push to YouTube needs the YouTube Data API v3 switched on for the same project: `gcloud services enable youtube.googleapis.com --project gen-lang-client-0484635733`. This is per project, not per hostname.

## Roll back

Check out the commit to return to and run `bun run deploy`. To take the site down, `sudo systemctl disable --now cratesync` on the mini, and `bun run tunnel unroute music.beric.ca` in the homelab repo to drop the DNS record.
