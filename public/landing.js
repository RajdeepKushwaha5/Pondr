const { icon, duck, productArt } = PondrUI;
mountHeader("landing");
if (new URLSearchParams(location.search).has("shot")) document.documentElement.classList.add("shot");

const put = (id, html) => { const el = document.getElementById(id); if (el) el.outerHTML = html; };
for (const [id, name] of [["icA", "arrow"], ["icB", "arrow"], ["icC", "arrow"], ["icD", "arrow"], ["icDrop", "drop"], ["icEye", "eye"], ["icBag", "bag"]]) put(id, icon(name, id.startsWith("ic") && id.length > 3 && ["icDrop", "icEye", "icBag"].includes(id) ? 14 : 16));
document.getElementById("heroDuck").innerHTML = duck(52, "think");
document.getElementById("heroArt").innerHTML = productArt("headphones", 150);
document.getElementById("bigDuck").innerHTML = duck(84, "happy");

// What the AI does / never does
const li = (ic, t) => `<li>${icon(ic, 16)}<span>${t}</span></li>`;
document.getElementById("yesList").parentElement.classList.add("yes");
document.getElementById("noList").parentElement.classList.add("no");
document.getElementById("yesList").innerHTML = [
  "Gets to know your goal and proposes settings you confirm",
  "Decides when an interruption is worth it, and stays quiet otherwise",
  "Writes the duck's words from facts the server hands it",
  "Turns \"I want these, but cheaper\" into a watch with rules",
].map((t) => li("check", t)).join("");
document.getElementById("noList").innerHTML = [
  "Do the maths. Days of saving and budgets are computed in code",
  "Invent a balance, a price or a date it wasn't given",
  "Capture a payment. Every purchase needs your approval in PayPal",
  "Take instructions from product pages, or act in group chats",
].map((t) => li("x", t)).join("");

// PayPal spec
const spec = [
  ["Checkout", "Orders v2 · create → approve → capture", "Goal contributions, Buy now, and agent purchases. Rules are re-checked before every capture."],
  ["Webhooks", "Signature-verified events", "The goal only moves after a confirmed capture. Duplicates are ignored."],
  ["Subscriptions", "Product → plan → subscription", "A monthly contribution, saved before you can spend it."],
  ["Payouts", "Payouts API · status polling", "Your goal stays yours: pay it back to your PayPal any time."],
  ["Agent", "Server-side tools with guardrails", "The agent can prepare an order. It can never capture one."],
];
document.getElementById("spec").innerHTML = spec.map(([a, b, c]) => `<div class="spec-row"><b>${a}</b><code>${b}</code><span>${c}</span></div>`).join("");

// Calculator, using the demo profile's real numbers when the API is reachable
let pace = 300;
let pond = { balance: 140, target: 600 };
const range = document.getElementById("calcRange");
function calc(v) {
  const exact = v / (pace / 30);
  const days = exact < 1 ? "<1" : Math.round(exact);
  document.getElementById("calcVal").textContent = `€${v}`;
  document.getElementById("calcDays").textContent = days;
  document.getElementById("calcUnit").textContent = days === 1 ? "day of saving" : "days of saving";
  const now = Math.min(100, (pond.balance / pond.target) * 100);
  const after = Math.min(100, ((pond.balance + v) / pond.target) * 100);
  document.getElementById("cNow").style.width = `${now}%`;
  Object.assign(document.getElementById("cAdd").style, { left: `${now}%`, width: `${after - now}%` });
  document.getElementById("cL").textContent = `Today ${Math.round(now)}%`;
  document.getElementById("cR").textContent = `${Math.round(after)}% if you put it toward the goal`;
  document.querySelectorAll("#presets button").forEach((b) => b.classList.toggle("on", Number(b.dataset.v) === v));
}
range.oninput = () => calc(Number(range.value));
document.querySelectorAll("#presets button").forEach((b) => (b.onclick = () => { range.value = b.dataset.v; calc(Number(b.dataset.v)); }));
calc(89);
getState()
  .then((s) => {
    if (s.user.monthlySavingsPace > 0 && !s.activePond.placeholder) {
      pace = s.user.monthlySavingsPace;
      pond = s.activePond;
      document.getElementById("paceTxt").textContent = `€${pace}`;
      calc(Number(range.value));
    }
  })
  .catch(() => {});

// Goal section: the bar fills and the number counts up when it scrolls into view
function playGoal() {
  document.getElementById("goalAdd").style.width = `${(89 / 600) * 100}%`;
  const el = document.getElementById("goalNum");
  const start = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - start) / 1400), e = 1 - Math.pow(1 - k, 3);
    el.textContent = `€${Math.round(140 + 89 * e)}`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (e.target.id === "goalDemo") playGoal();
    io.unobserve(e.target);
  }),
  { threshold: 0.2 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
if (document.documentElement.classList.contains("shot")) playGoal();
