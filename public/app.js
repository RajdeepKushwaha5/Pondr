const { icon, duck } = PondrUI;
let state;

mountHeader("home");
for (const [elId, name] of [["icShop", "bag"], ["icPlus", "plus"], ["icGift", "gift"], ["icSend", "send"], ["icTag", "tag"], ["icCal", "calendar"], ["icReset", "reset"], ["icClock", "clock"]]) {
  document.getElementById(elId).outerHTML = icon(name, 16);
}
document.getElementById("floater").innerHTML = duck(58, "calm");
document.getElementById("today").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

// ---------- Pond water ----------
let level = 0;
let shown = 0;
let t = 0;
function wave(lvl, phase, amp, freq) {
  const y = 200 - lvl * 172;
  let d = `M0 ${y}`;
  for (let x = 0; x <= 600; x += 12) d += ` L${x} ${(y + Math.sin((x / 600) * Math.PI * 2 * freq + phase) * amp).toFixed(1)}`;
  return `${d} L600 200 L0 200 Z`;
}
function animate() {
  t += 0.018;
  shown += (level - shown) * 0.06;
  document.getElementById("w1").setAttribute("d", wave(Math.min(1, shown + 0.04), t * 0.8, 7, 1.3));
  document.getElementById("w2").setAttribute("d", wave(shown, t + 1.5, 5, 1.8));
  document.getElementById("w3").setAttribute("d", wave(Math.max(0, shown - 0.07), t * 1.3 + 3, 4, 2.4));
  const water = document.getElementById("water");
  document.getElementById("floater").style.bottom = `${Math.max(6, shown * water.clientHeight * 0.86 - 30)}px`;
  requestAnimationFrame(animate);
}

function renderPond() {
  const p = state.activePond;
  const pct = Math.round((p.balance / p.target) * 100);
  level = 0.1 + 0.85 * Math.min(1, p.balance / p.target); // keep a visible base of water
  if (!shown) shown = level;
  document.getElementById("pondSelect").innerHTML = state.ponds.map((x) => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  document.getElementById("pondPct").textContent = `${pct}% full`;
  document.getElementById("pondAmount").innerHTML = `${eur(p.balance)}<small>of ${eur(p.target)}</small>`;
  const perDay = state.user.monthlySavingsPace / 30;
  const daysLeft = perDay > 0 ? Math.ceil(Math.max(0, p.target - p.balance) / perDay) : null;
  const ponded = state.payments.filter((x) => x.kind === "pond" && x.status === "completed").reduce((s, x) => s + x.amount, 0);
  document.getElementById("pondMeta").innerHTML =
    `<span><b>${daysLeft ?? "–"}</b> days to go</span><span><b>${eur(state.user.monthlySavingsPace)}</b>/mo stated pace</span>${ponded ? `<span><b>${eur(ponded)}</b> ponded from impulses</span>` : ""}${p.pendingWithdrawal ? `<span style="color:var(--duck-deep)"><b>${eur(p.pendingWithdrawal)}</b> payout pending</span>` : ""}`;
  document.getElementById("payoutBtn").disabled = !!p.pendingWithdrawal || p.balance <= 0;
  document.getElementById("hello").innerHTML = `Hey ${esc(state.user.name)}. Think <span class="serif">before</span> you pay.`;
}

function renderMandates() {
  const el = document.getElementById("mandates");
  if (!state.mandates.length) {
    el.innerHTML = `<li class="empty">No watches yet.<br>In the store choose <b>Wait &amp; Watch</b>, or tell Pondr <b>"watch the headphones for 75"</b>.</li>`;
    return;
  }
  el.innerHTML = state.mandates
    .map((m) => {
      const product = state.products.find((p) => p.id === m.productId);
      const action =
        m.status === "awaiting_approval"
          ? `<a class="btn yellow sm" href="/approve.html?payment=${m.paymentId}">Review &amp; approve ${icon("arrow", 14)}</a>`
          : m.status === "watching"
            ? `<button class="btn outline sm" data-release="${m.id}">Let it go</button>`
            : "";
      const mk = m.market?.results ? m.market : null;
      const market = mk?.results.length
        ? `<div class="item-sub">Market check (${mk.source === "channel3" ? "Channel3" : "demo data"}, ${new Date(mk.retrievedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}): ${mk.results.map((r) => `${money(r.price, r.currency)} ${esc(r.domain || "")}`).join(" · ")}. Comparison only${mk.results.some((r) => r.currency !== (mk.storeCurrency || "EUR")) ? ", other currencies not converted" : ""}; Pondr buys from ${esc(m.merchant || "the demo store")}.</div>`
        : "";
      const cool = m.status === "watching" && m.coolOffUntil && new Date(m.coolOffUntil) > new Date() ? ` · cooling-off until ${new Date(m.coolOffUntil).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "";
      return `<li class="item">
        <div class="item-title">${icon(m.status === "fulfilled" ? "check" : "eye", 16)}${esc(m.productName)}<span class="pill ${m.status}">${m.status.replace("_", " ")}</span><span class="spacer"></span>${action}</div>
        <div class="item-sub"><span class="mono">≤ ${eur(m.maxPrice)}</span> · now <span class="mono">${eur(product?.price)}</span> · until ${new Date(m.deadline).toLocaleDateString([], { month: "short", day: "numeric" })}${m.minPondProgressPct ? ` · once pond ≥ ${m.minPondProgressPct}%` : ""}${cool}</div>
        ${market}
        ${m.summary ? `<div class="item-note">${esc(m.summary)}${m.summarySource === "template" ? ' <span class="muted">(template, AI unavailable)</span>' : ""}</div>` : ""}
        ${m.lastNote ? `<div class="item-note muted"><b>Why it's waiting:</b> ${esc(m.lastNote)}</div>` : ""}
        ${m.priceDrop ? `<div class="item-note saved">Bought at ${eur(m.priceDrop)} under the price when you started watching</div>` : ""}
        ${m.status === "released" ? `<div class="item-note saved">You let it go. Nothing spent.</div>` : ""}
        ${(() => { const p = state.payments.find((x) => x.id === m.paymentId); return p && ["capturing", "processing", "unknown", "unresolved"].includes(p.status) ? `<div class="item-note" style="color:var(--duck)">PayPal outcome ${p.status === "unresolved" ? "unresolved, needs attention" : "pending"}. Budget stays held until PayPal confirms.</div>` : ""; })()}
        ${m.status === "awaiting_approval" && m.receipt ? receiptHtml(m.receipt) : ""}
        ${m.events?.length ? `<details class="tl-wrap"><summary>Timeline · ${m.events.length} steps</summary>${timelineHtml(m.events)}</details>` : ""}
      </li>`;
    })
    .join("");
  el.querySelectorAll("[data-release]").forEach((b) => (b.onclick = async () => { await api(`/api/mandates/${b.dataset.release}/release`, {}); toast("Let it go. That's a win too."); refresh(); }));
}

let pending = false;
function renderChat() {
  const log = document.getElementById("chatLog");
  const msgs = state.chat.length ? state.chat : [{ role: "assistant", text: `Hi ${state.user.name}, I'm Pondr. Ask me where your money went, or tell me something you want and I'll watch it for you.` }];
  log.innerHTML =
    msgs.map((m) => {
      const tags = [...(m.tools || []), ...(m.source === "template" ? ["template reply · AI unavailable"] : [])];
      return `<div class="msg ${m.role}">${esc(m.text)}${tags.length ? `<div class="tools">${tags.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}</div>`;
    }).join("") +
    (pending ? `<div class="msg assistant"><span class="typing"><i></i><i></i><i></i></span></div>` : "");
  log.scrollTop = log.scrollHeight;
  document.getElementById("chatMode").textContent = state.modes.ai !== "mock" ? `${state.modes.aiName} agent` : "Demo mode";
  document.getElementById("suggest").style.display = state.chat.length ? "none" : "flex";
}

function renderInsights() {
  const i = state.insights;
  const entries = Object.entries(i.byCategory).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map((e) => e[1]), 1);
  const impulse = new Set(["electronics", "fashion", "home"]);
  document.getElementById("insights").innerHTML = `
    <div class="stat">${eur(i.spentLast30)}</div>
    <div class="bars">${entries
      .map(([c, v]) => `<div class="bar"><span>${esc(c)}</span><div class="track"><div class="${impulse.has(c) ? "hot" : ""}" style="width:${(v / max) * 100}%"></div></div><span>${eur(v)}</span></div>`)
      .join("")}</div>
    <div class="eyebrow" style="margin-bottom:8px">Recurring charges</div>
    <div class="chips">${i.recurring.map((r) => `<span class="chip">${icon("repeat", 12)}${esc(r.merchant)} <b>${eur(r.amount)}</b></span>`).join("") || '<span class="muted small">None found</span>'}</div>
    ${i.demoData ? `<p class="small muted" style="margin:12px 0 0">Seeded demo history plus purchases you make in the demo store.</p>` : ""}`;
}


// ---------- Pondr on your phone (Telegram) ----------
let linkInfo = null;
function renderTelegram() {
  const t = state.telegram || { mode: "off" };
  const el = document.getElementById("telegram");
  if (t.mode !== "live") {
    el.innerHTML = `<p class="small" style="margin-top:0">The duck can message you first: when a watch is ready, when your budget says wait, and when PayPal confirms a payment. You can approve, let it go, or pond from your phone.</p>
      <p class="small muted">${t.mode === "error" ? "Telegram couldn't start. Check TELEGRAM_BOT_TOKEN." : "Not enabled on this server yet (TELEGRAM_BOT_TOKEN missing)."}</p>`;
    return;
  }
  if (t.linked) {
    el.innerHTML = `<p style="margin-top:0">${icon("check", 16)} Connected${t.name ? ` as <b>${esc(t.name)}</b>` : ""} to <b>@${esc(t.bot)}</b>.</p>
      <p class="small muted">Pondr will message you first. Try /checkin, /pond 20 or just chat.</p>
      <div class="row"><button class="btn dark sm" id="tgCheckin">${icon("send", 14)} Send me a check-in</button><button class="btn outline sm" id="tgUnlink">Disconnect</button></div>`;
    document.getElementById("tgCheckin").onclick = async () => { try { await api("/api/telegram/checkin", {}); toast("Check-in sent to your phone"); } catch (e) { toast(e.message); } };
    document.getElementById("tgUnlink").onclick = async () => { await api("/api/telegram/unlink", {}); linkInfo = null; refresh(); };
    return;
  }
  el.innerHTML = linkInfo
    ? `<div class="tg-link"><div id="tgQr" class="qr"></div><div><p style="margin-top:0"><b>Scan with your phone</b> or open the link. It carries a one-time code (valid 10 min), so no passwords go through chat.</p>
        <p><a class="btn dark sm" href="${esc(linkInfo.url)}" target="_blank" rel="noopener">Open @${esc(linkInfo.bot)}</a></p><p class="small muted">Code <code>${esc(linkInfo.code)}</code>. This panel updates once you tap Start.</p></div></div>`
    : `<p class="small" style="margin-top:0">Get the duck on your phone. It messages you first when something happens, and you can approve, let it go, or pond right from Telegram.</p>
      <button class="btn dark" id="tgLink">${icon("send", 16)} Connect Telegram</button>`;
  if (linkInfo && window.QRCode) new QRCode(document.getElementById("tgQr"), { text: linkInfo.url, width: 132, height: 132, colorDark: "#15171b", colorLight: "#fffdf8" });
  const b = document.getElementById("tgLink");
  if (b) b.onclick = async () => { try { linkInfo = await api("/api/telegram/link", {}); renderTelegram(); } catch (e) { toast(e.message); } };
}

// ---------- Onboarding confirmation card (the AI proposes, you confirm) ----------
function renderSetup() {
  const p = state.pendingSetup;
  const el = document.getElementById("setupCard");
  if (!p) { el.innerHTML = ""; return; }
  const row = (k, v) => (v === undefined || v === null ? "" : `<span>${k}</span><b class="mono">${v}</b>`);
  el.innerHTML = `<div class="setup-card"><div class="eyebrow">Confirm before I save</div>
    <div class="kv">${row("Name", p.name && esc(p.name))}${row("Goal", p.goalName && esc(p.goalName))}${row("Target", p.goalTarget && eur(p.goalTarget))}${row("Income", p.monthlyIncome && `${eur(p.monthlyIncome)}/mo`)}${row("Saving", p.monthlySavingsPace && `${eur(p.monthlySavingsPace)}/mo`)}${row("Fun budget", p.monthlyFunBudget !== undefined && `${eur(p.monthlyFunBudget)}/mo`)}</div>
    <div class="row"><button class="btn dark sm" id="setupOk">${icon("check", 14)} Looks right, save</button><button class="btn outline sm" id="setupNo">Not right</button></div></div>`;
  document.getElementById("setupOk").onclick = async () => { await api("/api/setup/confirm", {}); toast("Saved. Pondr will use these from now on."); refresh(); };
  document.getElementById("setupNo").onclick = async () => { await api("/api/setup/dismiss", {}); refresh(); };
}

function renderBudget() {
  const b = state.budget;
  const pct = b.budget > 0 ? Math.max(0, Math.min(100, (b.remaining / b.budget) * 100)) : 0;
  document.getElementById("budget").innerHTML = `
    <div class="stat">${eur(Math.max(0, b.remaining))}<span class="small muted" style="font-family:var(--ui);letter-spacing:0"> left</span></div>
    <div class="meter" style="margin:14px 0 6px"><div class="meter-track"><div class="now" style="width:${pct}%"></div></div></div>
    <div class="kv"><span>Your monthly fun budget</span><b class="mono">${eur(b.budget)}</b><span>Spent on wants (30 days)</span><b class="mono">${eur(b.spent)}</b><span>Waiting for your approval</span><b class="mono">${eur(b.committed)}</b></div>
    <p class="small muted" style="margin:0 0 10px">The agent only prepares a purchase that fits what's left. Groceries, rent and subscriptions don't count.</p>
    <div class="row"><input id="budgetIn" type="number" min="0" max="10000" step="10" value="${b.budget}" style="width:110px" aria-label="Monthly fun budget"><button class="btn outline sm" id="budgetBtn">Update</button></div>`;
  document.getElementById("budgetBtn").onclick = async () => {
    try { await api("/api/budget", { monthlyFunBudget: Number(document.getElementById("budgetIn").value) }); toast("Fun budget updated"); refresh(); } catch (e) { toast(e.message); }
  };
}

function renderAutopond() {
  const s = state.subscription;
  const el = document.getElementById("autopond");
  if (s && ["ACTIVE", "APPROVED"].includes(s.status)) {
    el.innerHTML = `<div class="stat">${eur(s.amount)}<span class="small muted" style="font-family:var(--ui);letter-spacing:0"> / month</span></div>
      <p class="small">Collected monthly by PayPal and added to your goal ledger.</p>
      <div class="kv"><span>Subscription</span><code>${esc(s.id)}</code><span>Status</span><span style="color:var(--good);font-weight:600">${esc(s.status)}</span></div>`;
    return;
  }
  el.innerHTML = `<p class="small" style="margin-top:0">Save <span class="serif" style="font-size:17px">before</span> you spend. Pondr sets up a monthly PayPal subscription; pick a date near your payday.</p>
    <div class="range-row"><input id="apAmount" type="range" min="10" max="200" step="5" value="50" aria-label="Amount per payday"><output id="apOut">€50</output></div>
    <button class="btn dark" id="apBtn" style="margin-top:12px;width:100%;justify-content:center">${icon("calendar", 16)} Set up with PayPal</button>
    ${s ? `<p class="small muted">Last attempt: ${esc(s.status)}</p>` : ""}`;
  const r = document.getElementById("apAmount");
  r.oninput = () => (document.getElementById("apOut").textContent = eur(r.value));
  document.getElementById("apBtn").onclick = async () => {
    try {
      const res = await api("/api/autopond", { amount: Number(r.value) });
      location.href = res.approveUrl;
    } catch (e) { toast(e.message); }
  };
}

const kindIcon = { released: "check", waiting: "clock", clock: "clock", ponded: "drop", payday: "calendar", autopond: "calendar", watch: "eye", ready: "spark", bought: "bag", payout: "gift", price: "tag", stop: "x", expired: "clock", failed: "x", pond: "drop" };
function renderActivity() {
  document.getElementById("activity").innerHTML = state.activity
    .slice(0, 6)
    .map((a) => `<li><span class="dot k-${a.kind || "info"}">${icon(kindIcon[a.kind] || "pulse", 14)}</span><span>${esc(a.text)}</span><time>${ago(a.at)}</time></li>`)
    .join("");
}

function renderDemo() {
  const sel = document.getElementById("dropProduct");
  const prev = sel.value;
  sel.innerHTML = state.products.map((p) => `<option value="${p.id}">${esc(p.name)} · ${eur(p.price)}</option>`).join("");
  if (prev) sel.value = prev;
  const m = state.modes;
  document.getElementById("modeNote").textContent =
    `PayPal ${m.paypal === "sandbox" ? "sandbox: real sandbox API calls, no real money" : "mock: add sandbox keys in .env for real PayPal sandbox calls"} · AI ${m.aiName}${m.aiModel ? ` (${m.aiModel})` : ""} · Channel3 ${m.channel3}`;
}

async function refresh() {
  state = await getState();
  renderPond();
  renderMandates();
  renderChat();
  renderInsights();
  renderAutopond();
  renderBudget();
  renderTelegram();
  renderSetup();
  renderActivity();
  renderDemo();
}

document.getElementById("pondSelect").onchange = async (e) => { await api(`/api/ponds/${e.target.value}/activate`, {}); refresh(); };

document.getElementById("newPondBtn").onclick = async () => {
  const name = prompt("What are you saving for?", "Summer trip");
  if (!name) return;
  const target = Number(prompt("Target amount (€)", "400"));
  if (!target) return;
  await api("/api/ponds", { name, target });
  refresh();
};

document.getElementById("payoutBtn").onclick = async () => {
  const p = state.activePond;
  if (!confirm(`Request a sandbox payout of ${eur(p.balance)} from ${p.name}? The balance only changes after PayPal confirms delivery.`)) return;
  try { await api(`/api/ponds/${p.id}/payout`, {}); toast("Payout requested. The pond updates when PayPal confirms delivery."); refresh(); } catch (e) { toast(e.message); }
};

async function sendChat(text) {
  if (!text || pending) return;
  state.chat.push({ role: "user", text });
  pending = true;
  renderChat();
  try { await api("/api/chat", { text }); } catch (err) { toast(err.message); }
  pending = false;
  refresh();
}
document.getElementById("chatForm").onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  input.value = "";
  sendChat(text);
};
document.querySelectorAll("#suggest button").forEach((b) => (b.onclick = () => sendChat(b.textContent)));

document.getElementById("dropBtn").onclick = async () => {
  const productId = document.getElementById("dropProduct").value;
  const price = Number(document.getElementById("dropPrice").value);
  if (!price) return toast("Enter a new price first");
  const btn = document.getElementById("dropBtn");
  btn.disabled = true;
  try {
    const r = await api("/api/demo/price", { productId, price });
    const ready = r.mandates.find((m) => m.status === "awaiting_approval");
    const waiting = r.mandates.find((m) => m.status === "watching" && m.lastNote);
    toast(ready ? "Your rules are met. Pondr prepared a PayPal order for you to approve." : waiting ? `Agent is waiting: ${waiting.lastNote}` : "Price updated");
  } catch (e) { toast(e.message); }
  btn.disabled = false;
  refresh();
};

document.querySelectorAll("[data-scenario]").forEach((b) => (b.onclick = async () => {
  if (!confirm("This resets your demo and sets up the scenario. Continue?")) return;
  try {
    const r = await api(`/api/demo/scenario/${b.dataset.scenario}`, {});
    toast(r.message);
    setTimeout(() => (location.href = r.redirect), 900);
  } catch (e) { toast(e.message); }
}));

document.getElementById("skipBtn").onclick = async () => {
  try {
    const r = await api("/api/demo/skip-day", {});
    toast(r.mandates.some((m) => m.status === "awaiting_approval") ? "A day passed. Your rules are met: review the prepared order." : "A day passed");
  } catch (e) { toast(e.message); }
  refresh();
};

document.getElementById("paydayBtn").onclick = async () => {
  try { await api("/api/demo/payday", {}); toast("Monthly cycle simulated"); refresh(); } catch (e) { toast(e.message); }
};

document.getElementById("resetBtn").onclick = async () => {
  if (!confirm("Reset all demo data?")) return;
  await api("/api/demo/reset", {});
  refresh();
};

const params = new URLSearchParams(location.search);
if (params.get("autopond") === "done") toast("Payday auto-pond is set up");
if (params.get("done")) toast("Pond payment processed");
if ([...params.keys()].length) history.replaceState(null, "", "/app.html");

refresh();
setInterval(() => { if (!pending) refresh(); }, 15000);
setInterval(() => { if (linkInfo && !state?.telegram?.linked && !pending) refresh(); }, 3000);
requestAnimationFrame(animate);
