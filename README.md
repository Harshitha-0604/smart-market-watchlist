# Signal — a smart market watchlist

Built for Groww Code 2026 — "Build a Smart Market Watchlist."

## Run it

No build step, no external packages, no API keys.

```bash
node server.js
```

Then open **http://localhost:8787**. That's it — the frontend is served
by the same process. First load auto-seeds a starter board (CHIPFAB,
SPACEX2, PAYNEXT, POWERGD) so the "what's changed" feed isn't empty.

Requires only Node.js (tested on v22; anything ≥ v16 will work — no
dependencies are used at all, so there's nothing to `npm install`).

## What it does

- **Create and manage a watchlist.** Search any of the ~30 simulated
  tickers and add/remove them from your board.
- **View latest market information.** Live price, a 60-tick sparkline,
  and volume, refreshed on a 4s poll.
- **Return later and see what's changed** — the core of the brief.
  Every ticker tracks a server-side "last seen" snapshot per user, so
  the diff survives a refresh, a new tab, or a different device (as
  long as it's the same `userId`, see "What I'd add" below).

## The unique piece: an attention score, not a percentage

The obvious version of this problem shows `%change` and calls it a day.
That fails in an obvious way: **a 2% move on a sleepy utility stock and
a 2% move on a volatile small-cap are not equally interesting**, but a
plain percentage treats them identically. Similarly, raw volume numbers
mean nothing without a baseline, and a real feed needs to be able to
say "gapped at open" or "there's news" as first-class facts, not
buried in a chart.

So instead of surfacing "what moved," this app surfaces **"what moved
in a way that matters,"** via a composite score per ticker
(`computeSignal()` in `server.js`):

| Signal | What it measures | Why it's separate from raw % |
|---|---|---|
| **Breakout / Reversal** | Price move since you last checked, divided by the ticker's own volatility (a z-score) | A quiet stock's small move can outrank a wild stock's usual-sized move |
| **Volume spike** | Volume so far this session vs. the volume expected for the elapsed fraction of the session | Catches "something's happening" even before the price has moved much |
| **Gap** | Difference between today's open and yesterday's close | Gaps carry different information than intraday drift |
| **News** | A simulated headline flag, decaying after ~10 minutes | Lets a qualitative event contribute to the score alongside quantitative ones |

These combine into one `score`, and:
- The **board (left rail) re-sorts itself by score**, not alphabetically
  or by watchlist order — the point of a *smart* watchlist is that it
  tells you where to look first.
- The **feed (main panel)** only shows tickers whose score clears a
  threshold, each labeled with which signal(s) fired and a plain-language
  reason ("broke out — moved 3.1%, well beyond its usual range").
- Clicking "mark as seen" resets that ticker's baseline — a deliberate,
  explicit action, rather than silently resetting on every view, so the
  user controls when "since you checked" restarts.

## Handling stale, delayed, or conflicting data

The brief specifically asks how the system handles this, so it's not
an afterthought:

- Every ticker carries `lastUpdate`. If a ticker hasn't ticked in
  **20s** (tunable via `STALE_AFTER_MS`), it's flagged `isStale: true`
  in the API response and shown with a visible "stale" tag and a
  **confidence** value in the UI — rather than silently presenting an
  old number as current.
- **Confidence decays with age** and directly discounts the attention
  score (`score *= confidence`), so a stale ticker can't dominate the
  "what changed" feed just because its last known value happened to be
  extreme.
- **Conflicting data** (e.g. two feeds disagreeing) isn't literally
  modeled here since there's one simulated feed, but the design already
  has the hook for it: `computeSignal` takes a single `ticker` snapshot,
  so a second source would resolve to "freshest timestamp wins, with
  confidence discounted by disagreement" before it ever reaches this
  function — a merge step ahead of scoring, not a change to scoring.

## How this scales

Built deliberately simple for a single-node, 72-hour build, but the
seams are placed where they'd need to move for real scale:

- **Storage**: currently one `db.json` file. The load/save path is two
  functions (`loadDB`/`saveDB`); swapping to Postgres (watchlists,
  last-seen snapshots) + Redis (live ticker state) is a localized
  change, not a rewrite, because nothing else in the app touches the
  file directly.
- **Fan-out**: the frontend polls every 4s. That's fine for one user;
  for many, the natural next step is a WebSocket/SSE push from a
  pub/sub layer (ticker update → publish → all subscribed clients),
  which avoids every client re-requesting the full board on a timer.
  Polling was the deliberate simple choice for this build — see the
  brief's own "where to keep things simple vs add complexity."
- **Score computation**: currently computed on-demand per request.
  At scale this moves to a background worker that recomputes scores
  as ticks land and pushes only the deltas, so a large watchlist
  doesn't mean a large per-request computation.
- **Large watchlists**: the board is a flat re-sorted list; past a few
  hundred tickers this would need virtualization in the UI and
  pagination/top-N in the API rather than returning the whole board.

## What I'd add with more time

- **Real cross-device auth.** Right now "cross device" works via a
  `userId` persisted in `localStorage` and sent as a query param — it
  genuinely survives a refresh or a new browser tab pointed at the same
  `userId`, but there's no login, so a *different* browser doesn't
  automatically know which `userId` to use. The server-side model
  (watchlist + last-seen keyed by user) is already what a real login
  would sit on top of; the missing piece is auth, not persistence.
- A real market data provider behind the same `ticker` shape.
- Configurable alert thresholds per user instead of one global cutoff.

## Files

```
server.js        — backend: simulated feed, persistence, attention engine, static file serving
public/index.html
public/styles.css
public/app.js    — frontend: board, feed, detail drawer, search, polling
```
