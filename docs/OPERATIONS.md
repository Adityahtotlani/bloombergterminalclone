# Operations Runbook

How the production instance runs and how to deploy, observe and fix it. Commands assume a shell on the production server. Drop `sudo` if you're already root.

## Production topology

| Public URL | Cloudflare Tunnel → | systemd unit | Process |
|---|---|---|---|
| <https://bloomberg.adityatotlani.ch> | `http://127.0.0.1:5173` | `bbg-web` | `vite preview` of the built frontend. Proxies `/api` to `127.0.0.1:8010` |
| <https://bloomberg-api.adityatotlani.ch> | `http://127.0.0.1:8010` | `bbg-api` | `uvicorn main:app` (FastAPI). `/` redirects to `/docs` |
| — | — | `cloudflared-bloomberg` | The Cloudflare Tunnel that publishes both hostnames |

Both app services listen on **127.0.0.1 only**. They're reachable from outside only through the tunnel, and no inbound ports are open for them.

> **Port 8000 on this server belongs to an unrelated service.** Production uses **8010** for the API. Don't run `start.sh` on the server: it starts a second backend on 8000 and a dev server on 5173, and both collide.

## The services

Unit files live in `/etc/systemd/system/`.

### `bbg-api`

- Working directory: the project's `backend/` folder.
- Runs `/usr/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8010`.
- Uses the **system Python**, not `backend/.venv`, so the packages in `backend/requirements.txt` must be installed for `/usr/bin/python3`. The versions installed there can differ from the pins in `requirements.txt`. For example, the server currently has FastAPI 0.115.6 while `requirements.txt` pins 0.111.0.
- Reads `backend/.env` at startup (`POLYGON_API_KEY`, `POLYGON_RATE_LIMIT`).
- `Restart=always`, `RestartSec=5`.

### `bbg-web`

- Working directory: the project's `frontend/` folder.
- `Environment=API_PROXY_TARGET=http://127.0.0.1:8010`.
- `ExecStartPre=/usr/bin/npm run build`: **the frontend is rebuilt on every start or restart**, so a restart deploys frontend changes. If the build fails, the service doesn't start.
- `ExecStart=/usr/bin/npx vite preview --host 127.0.0.1 --port 5173 --strictPort`. `--strictPort` means it fails rather than moving to another port if 5173 is taken.
- `vite preview` inherits `server.proxy` and `server.allowedHosts` from `frontend/vite.config.js`. `allowedHosts` must include `bloomberg.adityatotlani.ch`, or Vite rejects requests for that host.
- Ordered `After=bbg-api.service`. `Restart=always`, `RestartSec=5`.

### `cloudflared-bloomberg`

- Runs `cloudflared tunnel ... run` for a named tunnel, with a config file referenced in the unit file. That config's ingress rules map `bloomberg-api.adityatotlani.ch` → `http://127.0.0.1:8010` and `bloomberg.adityatotlani.ch` → `http://127.0.0.1:5173`, and everything else to 404.
- The tunnel's credentials and ID live outside the repo, are deliberately not documented here, and must never be committed.
- `Restart=always`, `RestartSec=10`. Logs go to the journal.

## Health checks

```bash
systemctl status bbg-api bbg-web cloudflared-bloomberg --no-pager

# backend direct, and through the frontend's proxy
curl -s http://127.0.0.1:8010/api/health
curl -s http://127.0.0.1:5173/api/health

# public, through the tunnel
curl -s https://bloomberg-api.adityatotlani.ch/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://bloomberg.adityatotlani.ch/
```

`/api/health` and `/api/economic-events` cost no upstream quota, so use them for checks. Don't put data endpoints in tight monitoring loops, because every uncached call uses one of the 5 requests per minute.

## Deploying

The code on the server *is* the working copy at the project root. To deploy:

1. Update the code: pull or commit the change into the project folder on the server.
2. If `frontend/package.json` dependencies changed, run `cd frontend && npm install`. If `backend/requirements.txt` changed, install it for the system Python used by `bbg-api`.
3. Restart both app services. This also rebuilds the frontend:

   ```bash
   sudo systemctl restart bbg-api bbg-web
   ```

4. Verify:

   ```bash
   systemctl is-active bbg-api bbg-web
   journalctl -u bbg-web -n 30 --no-pager      # build output and "Local: http://127.0.0.1:5173/"
   curl -s http://127.0.0.1:8010/api/health
   ```

Notes:

- Backend-only change: `sudo systemctl restart bbg-api` is enough. Frontend-only change: `sudo systemctl restart bbg-web`.
- Restarting `bbg-api` **clears every in-memory cache, the denial memo and the rate-limit window**. The first few minutes afterwards cost more upstream requests: the EOD market table has to be rebuilt, and Polygon may answer 429 once because it still counts requests from before the restart. Both are handled, but panels are slower for a minute or two. Avoid restarting repeatedly.
- The project is kept identical in the monorepo (`Adityahtotlani/projects`, folder `bloombergterminalclone/`) and the standalone repo (`Adityahtotlani/bloombergterminalclone`). Push changes to both.

## Logs

```bash
journalctl -u bbg-api -f                 # backend: access log and warnings
journalctl -u bbg-web -f                 # frontend build output and vite proxy errors
journalctl -u cloudflared-bloomberg -f   # tunnel connection status
journalctl -u bbg-api --since "1 hour ago" | grep -E "denied|429|Dropped"
journalctl -u bbg-api --since "1 hour ago" | grep "circuit breaker"   # provider incidents
```

Backend warnings worth knowing:

| Log line | Meaning |
|---|---|
| `POLYGON_API_KEY is not set — copy backend/.env.example to backend/.env` | The key is missing at startup. Every upstream call will fail |
| `Polygon rejected the API key (401) for ...` | The key is invalid, revoked or missing. Logged once per run of failures (again after a success). The top bar shows **API KEY ERROR**. See below |
| `Ignoring unreadable state file ...` / `Ignoring invalid state file ...` / `Ignoring stale data-mode evidence ...` | `backend/.state.json` couldn't be used at startup, so the indicator shows CONNECTED until the next quote. Harmless |
| `Could not write state file ...` | The backend couldn't save the last-known data mode (permissions or disk). The indicator still works until the next restart |
| `Polygon denied snapshot (403); skipping for 1800s` | Normal on the free tier: no live snapshots, so EOD fallback is used for 30 min before probing again |
| `Polygon denied options (403); skipping for 1800s` | Normal on the free tier: no options add-on |
| `Polygon denied financials (410); skipping for 300s` | The vX financials brownout is active. It's retried after 5 min |
| `Polygon returned 429 for ...; backing off` | Polygon's window is fuller than the local count (usually just after a restart). It's retried once |
| `Dropped queued upstream call ...: all clients disconnected` | A user switched tickers or closed the tab while the call was queued. Harmless; it frees a slot |
| `Polygon request timed out for ... (ReadTimeout)` | Polygon didn't answer within 15 s. The client got a 504 |
| `Polygon request failed for ... (ConnectError)` | Polygon couldn't be reached (network, DNS or TLS). The client got a 502 |
| `Polygon returned invalid JSON for ...` | Polygon answered 200 with a non-JSON body. The client got a 502 |
| `Polygon returned HTTP 500 for ...` (any unexpected status) | Polygon answered a status the backend has no special handling for. For a 5xx the client got a **502** `Data provider error (HTTP <status>) — retry shortly` (the browser retries it); for a 4xx (e.g. 404 for an unknown symbol) the same status with `Data provider error (HTTP <status>)`. Repeated 5xx usually mean a provider incident |
| `Polygon returned HTTP 403 for ...` / `Polygon returned HTTP 410 for ...` | Plan denial / deprecation. The client got the same status with a short fixed message (never Polygon's body). For the `snapshot`, `options` and `financials` families it is followed by a `Polygon denied ...` line and the endpoint degrades instead |
| `Provider circuit breaker OPEN after 3 consecutive failures (last: HTTP 500 for /v2/...); failing fast for 20s` | Three provider failures in a row (timeouts, unreachable, upstream 5xx or invalid JSON, on any endpoints). For 20 s new data requests get 503 `Data provider having issues — retry shortly` without calling Polygon, and `/api/health` shows `"provider":"degraded"`. See [Data provider incident](#data-provider-incident-data-provider-having-issues) |
| `Provider circuit breaker HALF-OPEN: probing with /v...` | The 20 s cooldown ended. One request is testing Polygon while the others wait behind it |
| `Provider circuit breaker OPEN: probe failed (<reason> for /v...); failing fast for 20s` | The test request failed too, so it's paused for another 20 s. During a long outage this repeats about 3 times a minute, and each probe costs one upstream request |
| `Provider circuit breaker CLOSED: provider answered HTTP <status> for /v...` | Polygon is answering again. Normal requests and caching resume, and the 20 s per-request failure memory is cleared |
| `[vite] http proxy error: /api/... ECONNREFUSED 127.0.0.1:8010` (bbg-web) | The backend was down or restarting when the frontend proxied a request |

The backend never logs the API key. Keep it that way: don't add logging of upstream URLs with their query strings, because the key travels as the `apiKey` query parameter.

## Rotating the Polygon API key

1. Create a new key in the Polygon/Massive dashboard.
2. Edit `backend/.env` on the server and replace the value of `POLYGON_API_KEY=`. Don't paste the key into commits, issues, chat or shell history you share. `backend/.env` is git-ignored, so keep it that way.
3. Restart the backend:

   ```bash
   sudo systemctl restart bbg-api
   ```

4. Verify: `journalctl -u bbg-api -n 20 --no-pager` shows no "not set" warning. Then load a ticker in the app. An `ECON` calendar alone doesn't prove anything, because it needs no key.
5. Revoke the old key in the dashboard.

For local development, copy `backend/.env.example` to `backend/.env` and add your own key. `start.sh` does the copy for you.

## Upgrading the data plan / changing the rate limit

The backend paces itself to `POLYGON_RATE_LIMIT` requests per minute (default 5, matching the free tier).

1. Upgrade the plan in the Polygon/Massive dashboard. Add the Options add-on if you want the options chain.
2. Edit `backend/.env`:

   ```bash
   POLYGON_RATE_LIMIT=100   # set to what your plan allows; paid stock plans are effectively unlimited
   ```

   Setting it **higher than the plan allows** just turns local queueing into Polygon 429s, which the backend handles but more slowly. Setting it **lower** wastes capacity.
3. `sudo systemctl restart bbg-api`. The restart also clears the 403 denial memo, so live snapshots and options are tried straight away instead of after up to 30 minutes. The top bar keeps showing the remembered **EOD DATA** until the first quote, watchlist or movers request succeeds, then switches to **LIVE**.
4. Check that quotes now return `"source": "live"`, and that the **EOD · DELAYED** label is gone:

   ```bash
   curl -s https://bloomberg-api.adityatotlani.ch/api/quote/AAPL | grep -o '"source":"[a-z]*"'
   ```

No code change is needed: live snapshots, the options chain and live movers activate automatically once the key is entitled.

## Troubleshooting

### Panels are slow or stuck on LOADING

Expected to some degree on the free tier. One ticker switch needs about 4–5 upstream requests, and the whole app gets 5 per minute, shared by **every visitor**.

- See how busy the queue is: `journalctl -u bbg-api --since "10 min ago" | grep -c "GET /api/"`, or watch for `Dropped queued upstream call`.
- Rapid ticker switching is the usual cause. Abandoned calls are dropped, but already-sent calls still count against the minute.
- If it's constant, upgrade the plan and raise `POLYGON_RATE_LIMIT` (above).

### "Data provider rate limit busy — retry shortly" (503)

A request waited more than 75 s for a slot, even after the browser's own retries. Same causes as above. The queue drains by itself within a minute or two. To see which endpoints are being hit most (for example a script hammering a data endpoint):

```bash
journalctl -u bbg-api --since "10 min ago" | grep "GET /api/" | awk '{print $10}' | sort | uniq -c | sort -rn | head
```

Client IPs in the access log are not useful here. Public traffic arrives through the local tunnel.

### "Data provider timed out" (504) or "Data provider unreachable" (502)

The backend couldn't get an answer from Polygon. The browser already retried a few times (over about 21 s) before showing the message. A failure is remembered for 20 s for that exact request, so repeats within that window get the same error without calling Polygon. After that the next request tries again. Successful data caches never hold an error.

- A 502 can also be Polygon answering 5xx (message `Data provider error (HTTP 5xx) — retry shortly`).
- Check the log lines: `journalctl -u bbg-api --since "10 min ago" | grep -E "timed out|request failed|invalid JSON|returned HTTP 5"`.
- Check that the server itself can reach Polygon: `curl -s -o /dev/null -w '%{http_code}\n' https://api.polygon.io/` (no key, so no quota). Any HTTP status, even 404, means it's reachable. `000` means it isn't.
- Check Polygon's status page. Repeated 504s across all endpoints usually mean a provider incident. Repeated 502s usually mean a local network or DNS problem.
- Each failed attempt still uses one of the 5 requests per minute, but repeats are rationed (20 s per request, and the circuit breaker below), so a provider problem can't use up the whole quota.

### Data provider incident ("Data provider having issues")

Panels show `DATA PROVIDER HAVING ISSUES — RETRY SHORTLY` (503). The backend saw three provider failures in a row and opened its circuit breaker. For 20 s it refuses new upstream calls, so retries don't spend the shared quota, and then it sends one probe. It recovers by itself as soon as a probe succeeds; **you don't need to restart anything**, and restarting doesn't help, because Polygon is still down after a restart.

1. Confirm: `curl -s http://127.0.0.1:8010/api/health` shows `"provider":"degraded"` (it reads local state only and costs no quota). `journalctl -u bbg-api --since "30 min ago" | grep -E "circuit breaker|timed out|request failed|returned HTTP 5|invalid JSON"` shows what is failing.
2. Work out where the problem is. `curl -s -o /dev/null -w '%{http_code}\n' https://api.polygon.io/` (no key, so no quota): `000` means a local network or DNS problem on this server, and any HTTP status means Polygon is reachable, so the incident is on Polygon's side. Check Polygon's status page.
3. Wait. While Polygon is down, the probes cost about 3 requests a minute, and only while visitors are using the app. Once a probe succeeds, the log shows `CLOSED` and `/api/health` goes back to `"provider":"ok"`. Panels that already gave up need the ticker re-selected.
4. If it is local (DNS, firewall, outbound network), fix that. The breaker closes on the next successful probe.

The breaker never opens for 401 (API key), 403/410 (plan or deprecation), 404 or 429, or for the backend's own `rate limit busy` 503. Those have their own sections above.

### Data panel shows "unavailable" or "requires add-on"

- `Options data requires Polygon Options Add-on`: the plan lacks options. Expected on the free tier.
- `Financials unavailable on current Polygon plan` or `Earnings data unavailable…`: usually a temporary 410 brownout of the deprecated `vX` financials endpoint. It retries after 5 minutes. If it becomes permanent, Polygon has retired the endpoint, and `get_financials` / `get_earnings` in `backend/main.py` need porting to its replacement.

### API KEY ERROR in the top bar

Polygon is rejecting the key in `backend/.env` (invalid, revoked, expired, or missing). Every data panel shows "Data provider rejected the API key — check POLYGON_API_KEY in backend/.env and restart the backend", and retrying won't help.

1. Confirm: `curl -s http://127.0.0.1:8010/api/health` shows `"data":"auth_error"`, and `journalctl -u bbg-api --since "1 hour ago" | grep "rejected the API key"` has entries.
2. Get a valid key from the Polygon/Massive dashboard (rotate it if the old one may have leaked) and set `POLYGON_API_KEY` in `backend/.env`. Never commit the key or paste it into logs or tickets.
3. `sudo systemctl restart bbg-api`. The key error isn't remembered across restarts and isn't added to the denial memo, so the new key is used on the very next request.
4. Load a ticker and check that `/api/health` no longer says `auth_error`.

### Data-mode state file (`backend/.state.json`)

The backend remembers the last-known data mode (`live` or `eod`) and when it saw it in `backend/.state.json`, so the top-bar indicator is right immediately after a restart. It holds only `{"data_mode": ..., "observed_at": ...}`, no secrets, and is gitignored. Entries older than 48 hours are ignored. **Deleting it is always safe**: the indicator shows CONNECTED until the next quote, watchlist or movers request, then the file is recreated. Set `BBG_STATE_FILE` to put it elsewhere, for example for a second test instance running from the same checkout.

### Site shows DISCONNECTED, or the public URL errors

1. `systemctl status bbg-api bbg-web cloudflared-bloomberg --no-pager`.
2. Local checks: `curl -s http://127.0.0.1:8010/api/health` and `curl -s http://127.0.0.1:5173/api/health`.
   - Both fail: `bbg-api` is down. Read `journalctl -u bbg-api -n 50`. Common causes are a Python import error after a deploy, or a missing package for the system Python.
   - 8010 works but 5173 doesn't: `bbg-web` is down, often because the `npm run build` in `ExecStartPre` failed. Read `journalctl -u bbg-web -n 80`.
3. Both local checks work but the public URL fails (Cloudflare error page, e.g. 502 or 530): the tunnel is down. Run `sudo systemctl restart cloudflared-bloomberg`, then `journalctl -u cloudflared-bloomberg -n 50` to look for registered connections or auth errors.
4. The app loads but shows "Blocked request. This host (...) is not allowed": the hostname is missing from `server.allowedHosts` in `frontend/vite.config.js`.

### Port conflicts

```bash
ss -ltnp | grep -E ':(8000|8010|5173)\b'
```

- **8000** belongs to another service on this server. Leave it alone.
- **8010** must be held only by `bbg-api`'s python3 process, and **5173** only by `bbg-web`'s node process. If something else holds them (for example a stray `npm run dev` or `start.sh`), stop it. `bbg-web` uses `--strictPort` and keeps restart-looping until 5173 is free.
- To move the API to another port, change `--port` in `bbg-api.service`, `API_PROXY_TARGET` in `bbg-web.service`, and the tunnel ingress. Then run `sudo systemctl daemon-reload && sudo systemctl restart bbg-api bbg-web cloudflared-bloomberg`.

### Economic calendar looks stale or ends early

The dates are hard-coded and need a yearly update. See [DATA-SOURCES.md → Yearly update procedure](DATA-SOURCES.md#yearly-update-procedure).

### Changes don't appear after deploy

- Frontend: `bbg-web` only rebuilds when it **restarts**. Check `systemctl show bbg-web -p ActiveEnterTimestamp` to see when it last started.
- Backend: `bbg-api` doesn't auto-reload. Restart it.
- Browser: hard-refresh to drop the cached `index.html` and assets.
