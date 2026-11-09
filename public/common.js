// Shared helpers for Pondr pages.
const api = (path, body) =>
  fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (n) => `€${Number(n).toFixed(2).replace(/\.00$/, "")}`;
// Formats an amount in its own currency (market offers may not be in euros).
const money = (n, cur = "EUR") => {
  try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(n); } catch { return `${n} ${cur}`; }
};
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

function toast(text) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

function mountHeader(active) {
  const el = document.getElementById("header");
  if (!el) return;
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? "active" : ""}">${label}</a>`;
  el.innerHTML = `<header class="topbar"><div class="topbar-inner">
    <a class="brand" href="/" aria-label="Pondr home">${PondrUI.duck(30)}<span class="word">pondr</span></a>
    <nav class="nav">${link("/", "Home", "landing")}${link("/app.html", "My ponds", "home")}${link("/store.html", "Demo store", "store")}</nav>
    <div class="modes" id="modes"></div>
    ${active === "landing" ? `<a class="btn dark sm" href="/app.html">Open the app ${PondrUI.icon("arrow", 14)}</a>` : ""}
  </div></header>`;
}

async function getState() {
  const s = await api("/api/state");
  window.PONDR_MODES = s.modes;
  const m = document.getElementById("modes");
  if (m) {
    const dot = (label, mode, onWord) => `<span title="${label}: ${mode}"><i class="${mode === onWord ? "on" : ""}"></i>${label} ${mode}</span>`;
    const ai = `<span title="AI: ${s.modes.aiModel || "demo templates"}"><i class="${s.modes.ai !== "mock" ? "on" : ""}"></i>${s.modes.aiName}</span>`;
    m.innerHTML = dot("PayPal", s.modes.paypal, "sandbox") + ai + dot("Channel3", s.modes.channel3, "live");
  }
  return s;
}

// Decision receipt: every value is computed by the server, never by the AI.
function receiptHtml(r) {
  if (!r) return "";
  const row = (k, v, ok = true) => `<div class="rc-row ${ok ? "" : "bad"}"><span>${k}</span><b>${v}</b></div>`;
  const b = r.budget;
  return `<div class="receipt">
    <div class="rc-head"><span>Decision receipt</span><span>${new Date(r.checkedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
    ${row("Price", `${eur(r.price)} ≤ max ${eur(r.maxPrice)} ✓`)}
    ${row("Cooling-off", `${r.coolOffHours}h passed ✓`)}
    ${row("Fun budget available", eur(b.available))}
    ${row("This purchase", `− ${eur(b.thisPurchase)}`)}
    ${row("Left after", eur(b.remainingAfter))}
    ${row("Goal money", `${esc(r.goal.name)} untouched (${r.goal.progressPct}%${r.goal.rulePct ? `, rule ≥ ${r.goal.rulePct}% ✓` : ""})`)}
    ${r.market ? row("Market", `${r.market.similarItems} similar items via ${r.market.source === "channel3" ? "Channel3" : "demo data"}${r.market.bestSameCurrency ? `, best EUR ${eur(r.market.bestSameCurrency)}` : ", none in EUR"}`) : ""}
    ${row("Merchant", esc(r.merchant || "Pondr Demo Store"))}
    <div class="rc-foot">Computed by Pondr's rules engine. The AI only writes the explanation.</div>
  </div>`;
}

const TL_ICON = { created: "eye", waiting: "clock", market: "chart", prepared: "wallet", approved: "check", paid: "check", stopped: "x", not_now: "clock", released: "check", expired: "clock", failed: "x", unknown: "clock", recovered: "reset" };
function timelineHtml(events) {
  if (!events?.length) return "";
  return `<ol class="tl-mini">${events
    .map((e) => `<li class="k-${e.kind}"><span class="tl-dot">${PondrUI.icon(TL_ICON[e.kind] || "pulse", 12)}</span><div><time>${new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>${esc(e.text)}${e.data?.captureId ? ` <code>${esc(e.data.captureId)}</code>` : ""}</div></li>`)
    .join("")}</ol>`;
}
