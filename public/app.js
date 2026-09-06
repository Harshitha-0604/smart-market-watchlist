const API = "";
const SIGNAL_LABEL = {
  breakout: "breakout",
  reversal: "reversal",
  volume_spike: "volume spike",
  gap: "gap",
  news: "news",
};

let userId = localStorage.getItem("signal_user_id");
let currentRows = [];
let pollTimer = null;

async function ensureSession() {
  if (userId) return userId;
  const res = await fetch(`${API}/api/session`, { method: "POST" });
  const data = await res.json();
  userId = data.userId;
  localStorage.setItem("signal_user_id", userId);
  return userId;
}

async function fetchWatchlist() {
  const res = await fetch(`${API}/api/watchlist?userId=${userId}`);
  const data = await res.json();
  currentRows = data.rows;
  renderBoard(currentRows);
  renderFeed(currentRows);
}

function primarySignal(row) {
  const order = ["reversal", "breakout", "volume_spike", "gap", "news"];
  for (const s of order) if (row.signals.includes(s)) return s;
  return "none";
}

function fmtAge(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

function renderBoard(rows) {
  const board = document.getElementById("board");
  const empty = document.getElementById("boardEmpty");
  board.innerHTML = "";
  empty.hidden = rows.length > 0;

  for (const row of rows) {
    const li = document.createElement("li");
    const sig = primarySignal(row);
    li.className = `board-row sig-${sig}`;
    li.innerHTML = `
      <div class="board-row-main">
        <div class="sym">${row.symbol}</div>
        <div class="name">${row.name}</div>
      </div>
      <div class="right">
        <div class="price">₹${row.price.toLocaleString("en-IN")}</div>
        <div class="score">score ${row.score}${row.isStale ? " · stale" : ""}</div>
      </div>
      <button class="remove-btn" title="Remove from board" data-symbol="${row.symbol}">✕</button>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.closest(".remove-btn")) return;
      openDetail(row.symbol);
    });
    li.querySelector(".remove-btn").addEventListener("click", () => removeTicker(row.symbol));
    board.appendChild(li);
  }
}

function renderFeed(rows) {
  const list = document.getElementById("feedList");
  const empty = document.getElementById("feedEmpty");
  list.innerHTML = "";

  const meaningful = rows.filter((r) => r.score >= 8).sort((a, b) => b.score - a.score);
  empty.hidden = meaningful.length > 0;

  for (const row of meaningful) {
    const li = document.createElement("li");
    const sig = primarySignal(row);
    const dir = row.pctSinceSeen >= 0 ? "up" : "down";
    li.className = `feed-row sig-${sig}`;
    li.innerHTML = `
      <div class="badge-col">
        <div class="sym mono">${row.symbol}</div>
        <div class="badges">
          ${row.signals.map((s) => `<span class="badge badge-${s}">${SIGNAL_LABEL[s]}</span>`).join("")}
        </div>
      </div>
      <div class="main">
        <div class="headline">
          <b>${row.name}</b> ${describeChange(row)}
        </div>
        <div class="sub">
          since you last checked · ${fmtAge(row.ageMs)} update
          ${row.isStale ? `<span class="stale-tag"> · stale, confidence ${Math.round(row.confidence * 100)}%</span>` : ""}
          ${row.news ? ` · "${row.news.headline}"` : ""}
        </div>
      </div>
      <div class="figures">
        <div class="pct ${dir}">${row.pctSinceSeen >= 0 ? "+" : ""}${row.pctSinceSeen}%</div>
        <div class="sub">₹${row.price.toLocaleString("en-IN")}</div>
      </div>
    `;
    li.addEventListener("click", () => openDetail(row.symbol));
    list.appendChild(li);
  }
}

function describeChange(row) {
  const sig = primarySignal(row);
  const move = Math.abs(row.pctSinceSeen);
  switch (sig) {
    case "breakout":
      return `broke out — moved ${move}%, well beyond its usual range (z=${row.zScore})`;
    case "reversal":
      return `reversed — down ${move}% against its recent direction`;
    case "volume_spike":
      return `is trading at ${row.volumeRatio}× its expected volume`;
    case "gap":
      return `gapped ${row.gapPct >= 0 ? "up" : "down"} ${Math.abs(row.gapPct)}% at open`;
    case "news":
      return `has a fresh headline out`;
    default:
      return `moved ${move}%`;
  }
}

function sparklineSVG(history) {
  if (!history || history.length < 2) return "";
  const w = 360, h = 60, pad = 4;
  const min = Math.min(...history), max = Math.max(...history);
  const range = max - min || 1;
  const step = (w - pad * 2) / (history.length - 1);
  const pts = history
    .map((v, i) => `${pad + i * step},${h - pad - ((v - min) / range) * (h - pad * 2)}`)
    .join(" ");
  const up = history[history.length - 1] >= history[0];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <polyline fill="none" stroke="${up ? "#2F7D4F" : "#B23A48"}" stroke-width="2" points="${pts}" />
  </svg>`;
}

async function openDetail(symbol) {
  const row = currentRows.find((r) => r.symbol === symbol);
  if (!row) return;
  const drawer = document.getElementById("detail");
  const body = document.getElementById("detailBody");
  const dir = row.pctSinceSeen >= 0 ? "up" : "down";

  body.innerHTML = `
    <div class="mono" style="color:var(--ink-soft); font-size:12px;">${row.symbol}</div>
    <h3>${row.name}</h3>
    <div class="detail-price mono">₹${row.price.toLocaleString("en-IN")}
      <span class="${dir}" style="font-size:15px;">${row.pctSinceSeen >= 0 ? "+" : ""}${row.pctSinceSeen}% since last check</span>
    </div>
    <div class="spark">${sparklineSVG(row.sparkline)}</div>
    <div class="row"><span>Attention score</span><span>${row.score}</span></div>
    <div class="row"><span>Volatility-adjusted move (z)</span><span>${row.zScore}</span></div>
    <div class="row"><span>Volume vs expected</span><span>${row.volumeRatio}×</span></div>
    <div class="row"><span>Gap at open</span><span>${row.gapPct}%</span></div>
    <div class="row"><span>Data freshness</span><span>${fmtAge(row.ageMs)}${row.isStale ? " · STALE" : " · live"}</span></div>
    <div class="row"><span>Confidence</span><span>${Math.round(row.confidence * 100)}%</span></div>
    ${row.news ? `<div class="news-box">📰 ${row.news.headline}</div>` : ""}
    <button class="ack-btn" data-symbol="${row.symbol}">Mark as seen — reset the "since you checked" baseline</button>
  `;
  body.querySelector(".ack-btn").addEventListener("click", () => ackTicker(row.symbol));
  drawer.hidden = false;
}

async function ackTicker(symbol) {
  await fetch(`${API}/api/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, symbol }),
  });
  document.getElementById("detail").hidden = true;
  fetchWatchlist();
}

async function removeTicker(symbol) {
  await fetch(`${API}/api/watchlist`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, symbol }),
  });
  fetchWatchlist();
}

async function addTicker(symbol) {
  await fetch(`${API}/api/watchlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, symbol }),
  });
  document.getElementById("search").value = "";
  document.getElementById("searchResults").hidden = true;
  fetchWatchlist();
}

// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------
let searchDebounce = null;
document.getElementById("search").addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const q = e.target.value.trim();
  const box = document.getElementById("searchResults");
  if (!q) { box.hidden = true; return; }
  searchDebounce = setTimeout(async () => {
    const res = await fetch(`${API}/api/universe?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    box.innerHTML = "";
    if (!data.results.length) {
      box.innerHTML = `<div class="search-item">No matches</div>`;
    } else {
      for (const r of data.results.slice(0, 8)) {
        const already = currentRows.some((row) => row.symbol === r.symbol);
        const item = document.createElement("div");
        item.className = "search-item";
        item.innerHTML = `<span>${r.symbol} <span style="color:var(--ink-soft)">— ${r.name}</span></span>
          <span class="add">${already ? "on board" : "+ add"}</span>`;
        if (!already) item.addEventListener("click", () => addTicker(r.symbol));
        box.appendChild(item);
      }
    }
    box.hidden = false;
  }, 150);
});

document.getElementById("detailClose").addEventListener("click", () => {
  document.getElementById("detail").hidden = true;
});
document.addEventListener("click", (e) => {
  const box = document.getElementById("searchResults");
  if (!e.target.closest(".search-wrap")) box.hidden = true;
});

function tickClock() {
  document.getElementById("clock").textContent =
    "market simulation live · " + new Date().toLocaleTimeString();
}

async function boot() {
  await ensureSession();
  await fetchWatchlist();
  // Seed a starter board on first visit so the feed isn't empty.
  if (currentRows.length === 0) {
    for (const s of ["CHIPFAB", "SPACEX2", "PAYNEXT", "POWERGD"]) {
      await addTicker(s);
    }
  }
  tickClock();
  setInterval(tickClock, 1000);
  pollTimer = setInterval(fetchWatchlist, 4000);
}

boot();
