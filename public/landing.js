const { icon, duck } = PondrUI;
mountHeader("landing");
if (new URLSearchParams(location.search).has("shot")) document.documentElement.classList.add("shot");

const put = (id, html) => { const el = document.getElementById(id); if (el) el.outerHTML = html; };
put("icA", icon("arrow", 18));
put("icB", icon("arrow", 18));
put("icC", icon("arrow", 18));
put("icYes", icon("check", 22));
put("icNo", icon("lock", 22));
document.getElementById("mockDuck").innerHTML = duck(76, "think");
document.getElementById("swimDuck").innerHTML = duck(64, "calm");
document.getElementById("bigDuck").innerHTML = duck(120, "happy");
document.getElementById("pp1").innerHTML = `${icon("shield", 14)} PayPal sandbox`;
document.getElementById("pp2").innerHTML = `${icon("spark", 14)} Agentic AI`;
document.getElementById("pp3").innerHTML = `${icon("lock", 14)} You approve every payment`;

// Hero mock choices (same markup as the real duck sheet)
const choice = (ic, title, sub, amt, primary) =>
  `<div class="choice ${primary ? "primary" : ""}"><span class="ci">${icon(ic, 18)}</span><span><b>${title}</b><small>${sub}</small></span>${amt ? `<span class="amt">${amt}</span>` : ""}</div>`;
document.getElementById("mockChoices").innerHTML =
  choice("drop", "Pond it", "Still press pay. It lands in your pond.", "€89", true) +
  choice("eye", "Wait &amp; Watch", "I'll buy it when the price is right.") +
  choice("bag", "Buy it now", "Your call. No judgement.", "€89");

// Ticker
const moments = [
  ["€89 headphones", "9 days of your apartment fund"],
  ["€120 sneakers at 2am", "ponded"],
  ["€45 desk lamp", "watching for €38"],
  ["€38 groceries", "no duck, essentials"],
  ["€249 \"it's on sale\"", "25 days of your goal"],
  ["€72 headphones", "agent found it, you approved"],
  ["€50 a month", "auto-ponded via PayPal Subscriptions"],
  ["€95 sneakers", "waiting: over your fun budget"],
  ["€45 lamp", "you let it go, nothing spent"],
];
const tick = moments.map(([a, b]) => `<span><i></i>${a} <em>→</em> ${b}</span>`).join("");
document.getElementById("ticker").innerHTML = tick + tick;

// Timeline
const steps = [
  ["y", "eye", "You", "Mon 09:12", "Watch the Aurora headphones. Max <code>€75</code>, within 30 days."],
  ["", "clock", "Pondr agent", "Mon 09:12", "Starts a <code>24h</code> cooling-off. No purchase can be prepared before Tuesday."],
  ["", "tag", "Store", "Thu 14:03", "Price drops from €89 to <code>€72</code>. Under your max."],
  ["", "wallet", "Pondr agent", "Thu 14:03", "Fun budget check: <code>€82</code> left, so €72 fits. Goal money is never touched."],
  ["", "chart", "Channel3", "Thu 14:03", "Market check: best offer elsewhere is €79. It's a good deal."],
  ["t", "wallet", "PayPal", "Thu 14:04", "Agent prepares a PayPal order for €72. It cannot capture it."],
  ["y", "check", "You", "Thu 14:06", "\"Still want it?\" Yes. Rules re-checked, approved in PayPal. <code>€17</code> under your starting price."],
];
document.getElementById("timeline").innerHTML = steps
  .map(([c, ic, who, when, what], i) => `<li class="reveal d${i % 3}"><span class="b ${c}">${icon(ic, 15)}</span><div><div class="who">${who}<time>${when}</time></div><div class="what">${what}</div></div></li>`)
  .join("");

// Guardrails
const li = (ic, t) => `<li>${icon(ic, 18)}<span>${t}</span></li>`;
document.getElementById("yesList").innerHTML = [
  "Decides when an interruption is actually worth it, and stays quiet otherwise",
  "Writes the duck's words from facts the server hands it",
  "Turns \"I want these, but cheaper\" into a structured mandate",
  "Compares market prices and prepares a PayPal order only when every rule you set is met",
  "Explains what it's waiting for: price, cooling-off, or budget",
].map((t) => li("check", t)).join("");
document.getElementById("noList").innerHTML = [
  "Do the maths. Days of saving and affordability are computed in code",
  "Invent a balance, a price or a date it wasn't given",
  "Capture a payment. Every purchase needs your approval in PayPal",
  "Take instructions from product pages. Page text is treated as data",
  "Buy from other retailers. Market prices are for comparison only",
].map((t) => li("x", t)).join("");

// PayPal spec
const spec = [
  ["Checkout", "Orders v2 · create → approve → capture", "Pond it, Buy now, and agent purchases from the integrated demo merchant. Rules re-checked before capture."],
  ["Webhooks", "PAYMENT.CAPTURE.COMPLETED · signature verified", "Signature-verified events only. The goal ledger changes only after a confirmed capture."],
  ["Subscriptions", "Catalog product → billing plan → subscription", "Monthly auto-pond: save before you can spend it."],
  ["Payouts", "/v1/payments/payouts · status polling", "Goal reached? Request a payout; the pond only drops once PayPal confirms delivery."],
  ["Agent", "Tool calls with server guardrails", "prepare_purchase re-checks your rule and can never capture."],
];
document.getElementById("spec").innerHTML = spec.map(([a, b, c]) => `<div class="spec-row"><b>${a}</b><code>${b}</code><span>${c}</span></div>`).join("");

// Calculator, using Ana's live numbers when the API is reachable
let pace = 300;
let pond = { name: "Apartment fund", balance: 140, target: 600 };
function calc(v) {
  const days = Math.max(1, Math.round(v / (pace / 30)));
  document.getElementById("calcVal").textContent = `€${v}`;
  document.getElementById("calcDays").textContent = days;
  document.getElementById("calcUnit").textContent = days === 1 ? "day" : "days";
  document.getElementById("calcGoal").textContent = `of your ${pond.name}.`;
  const now = Math.min(100, (pond.balance / pond.target) * 100);
  const after = Math.min(100, ((pond.balance + v) / pond.target) * 100);
  document.getElementById("cNow").style.width = `${now}%`;
  Object.assign(document.getElementById("cAdd").style, { left: `${now}%`, width: `${after - now}%` });
  document.getElementById("cL").textContent = `Today ${Math.round(now)}%`;
  document.getElementById("cR").textContent = `${Math.round(after)}% if you pond it`;
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === v));
}
const range = document.getElementById("calcRange");
range.oninput = () => calc(Number(range.value));
document.querySelectorAll("#presets button").forEach((b) => (b.onclick = () => { range.value = b.dataset.v; calc(Number(b.dataset.v)); }));
calc(89);
getState()
  .then((s) => {
    pace = s.user.monthlySavingsPace;
    pond = s.activePond;
    document.getElementById("paceTxt").textContent = `€${pace}`;
    document.getElementById("goalTxt").textContent = pond.name;
    calc(Number(range.value));
  })
  .catch(() => {});

// Hero waves
let t = 0;
function wave(y, phase, amp, freq) {
  let d = `M0 ${y}`;
  for (let x = 0; x <= 1440; x += 24) d += ` L${x} ${(y + Math.sin((x / 1440) * Math.PI * 2 * freq + phase) * amp).toFixed(1)}`;
  return `${d} L1440 190 L0 190 Z`;
}
(function animate() {
  t += 0.012;
  document.getElementById("lw1").setAttribute("d", wave(70, t, 12, 2));
  document.getElementById("lw2").setAttribute("d", wave(98, t * 1.3 + 2, 9, 2.6));
  document.getElementById("lw3").setAttribute("d", wave(128, t * 1.7 + 4, 7, 3.2));
  requestAnimationFrame(animate);
})();

// Scroll reveal
const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
