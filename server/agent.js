// Pondr's AI: the checkout duck, the chat buddy, and the Wait & Watch agent.
// Code supplies every number; Claude decides and writes; server tools enforce limits.
import { askJSON, runAgent, AIUnavailable } from "./llm.js";
import { getDb, save, log, id, product, activePond, mandateEvent, notify } from "./store.js";
import { financeSnapshot, mandateConditions, daysOfSaving, daysExact, round2, pondFor } from "./money.js";
import { searchMarket } from "./channel3.js";
import { startOrder } from "./payments.js";

const PERSONA = `You are Pondr, a friendly duck who helps young people with money.
You talk like a supportive friend: warm, short, a little playful, never preachy or shaming.
Use only the numbers given to you in FACTS or tool results. Never invent balances, prices or dates.
Spending is allowed; your job is to help the user choose deliberately, not to forbid things.
All money is in euros: always write amounts like €89. Write plain text only: no markdown, no asterisks, no emoji.`;

// ---------- 1. Checkout duck ----------
const DUCK_SCHEMA = {
  type: "object",
  properties: {
    intervene: { type: "boolean", description: "Whether showing the duck is worth interrupting this checkout" },
    message: { type: "string", description: "One or two friendly sentences" },
    reasons: { type: "array", items: { type: "string" }, description: "Up to 3 short, fact-based reasons to pause" },
  },
  required: ["intervene", "message", "reasons"],
  additionalProperties: false,
};

// The headline is always built by code so the numbers can't drift.
const headlineFor = (f) => {
  if (f.daysOfSaving === null || f.daysOfSaving === undefined) return `€${f.item.price} toward your ${f.pond.name}?`;
  if (f.daysOfSaving === 0) return `€${f.item.price} = less than a day of your ${f.pond.name}`;
  return `€${f.item.price} = ${f.daysOfSaving} day${f.daysOfSaving === 1 ? "" : "s"} of your ${f.pond.name}`;
};

export async function duckDecision(item, amount) {
  const facts = financeSnapshot(amount, item);
  const quiet = getDb().user.quietCategories.includes(item.category);
  if (quiet) {
    return { intervene: false, quietReason: `${item.category} is an essential category, so Pondr stays quiet.`, facts, source: "rule" };
  }
  // Small stuff: under one day of saving at the stated pace. Decided by code on the exact value.
  const exact = daysExact(amount);
  if (exact !== null && exact < 1) {
    return { intervene: false, quietReason: "That's less than a day of your saving pace, so Pondr stays out of the way.", facts, source: "rule" };
  }
  try {
    const decision = await askJSON({
      system: `${PERSONA}
You decide whether to show a checkout intervention. Intervene for impulse or discretionary purchases that set a goal back.
Do not intervene for small amounts that barely move the goal (under 1 day of saving) or essentials.
The message speaks to the user by name; reasons are short and quote only numbers from FACTS. Plain text, no emoji.
How the money works (do not get this wrong): buying now does NOT reduce the goal balance; it uses the fun budget (see ifBuyNow). Pond it ADDS the amount to the goal (see ifPondIt). Never compute new numbers; only quote values from FACTS.`,
      messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}` }],
      schema: DUCK_SCHEMA,
      effort: "low",
      maxTokens: 2000,
    });
    if (typeof decision.intervene !== "boolean" || typeof decision.message !== "string") throw new SyntaxError("Bad AI decision shape");
    const reasons = (Array.isArray(decision.reasons) ? decision.reasons : []).filter((r) => typeof r === "string").slice(0, 3);
    return { intervene: decision.intervene, headline: headlineFor(facts), message: decision.message, reasons, facts, source: "ai" };
  } catch (err) {
    if (!(err instanceof AIUnavailable) && !(err instanceof SyntaxError)) console.error("duckDecision:", err.message);
    return { ...mockDuck(facts), facts, source: "mock" };
  }
}

function mockDuck(f) {
  if (f.daysExact !== null && f.daysExact !== undefined && f.daysExact < 1) return { intervene: false, headline: "", message: "", reasons: [] };
  const reasons = [];
  if (f.spentLast30SameCategory > 0) reasons.push(`You've spent €${f.spentLast30SameCategory} on ${f.item.category} in the last 30 days.`);
  reasons.push(`Ponding it takes ${f.pond.name} from ${f.pond.progressPct}% to ${f.pondProgressIfPonded}%.`);
  if (f.localHour >= 22 || f.localHour < 6) reasons.push("It's late. Night-time carts are the ones people regret most.");
  return {
    intervene: true,
    headline: headlineFor(f),
    message: `Hey ${f.user}, quick quack before you pay! You can still press pay, and the money can go to your pond instead. Or I can watch for a better price.`,
    reasons: reasons.slice(0, 3),
  };
}

// ---------- 2. Chat buddy (agent with tools) ----------
const CHAT_TOOLS = [
  {
    name: "get_finances",
    description: "Get the user's current pond (goal) balance, savings pace, last-30-day spending by category and recurring charges.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_store_products",
    description: "List products in the Pondr Demo Store with current prices and ids.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_market",
    description: "Search live market prices across retailers (Channel3) for a product query.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, max_price: { type: "number" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "create_watch",
    description:
      "Create a Wait & Watch mandate for a Pondr Demo Store product. Pondr prepares a PayPal purchase for the user's approval only when the price is at or below max_price, the cooling-off period has passed, the purchase fits the user's fun budget, before the deadline, and (optionally) once the pond reaches a progress percentage.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        max_price: { type: "number", description: "Maximum total price in EUR" },
        deadline_days: { type: "integer", description: "Days from today; omit for 30" },
        cool_off_hours: { type: "integer", description: "Hours to wait before Pondr may prepare a purchase; omit for 24" },
        min_pond_progress_pct: { type: "integer", description: "Only buy once the pond is at least this % full; omit for none" },
      },
      required: ["product_id", "max_price"],
      additionalProperties: false,
    },
  },
  {
    name: "list_watches",
    description: "List the user's Wait & Watch mandates and their status.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_setup",
    description:
      "Propose the user's personal settings after they describe them: first name, the goal they are saving for and its target in EUR, monthly income, how much they can save per month, and a monthly fun budget for wants. This does NOT save anything; the user must confirm a card. Only include fields the user actually stated.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        goal_name: { type: "string", description: "e.g. Apartment fund, Trip to Japan" },
        goal_target: { type: "number" },
        current_savings: { type: "number", description: "What they have already saved toward this goal, if they said so" },
        monthly_income: { type: "number" },
        monthly_savings_pace: { type: "number" },
        monthly_fun_budget: { type: "number" },
      },
      additionalProperties: false,
    },
  },
];

// Validated, unsaved settings proposal. Applied only by an explicit user confirmation.
export function proposeSetup(input) {
  const num = (v, max) => (v === undefined || v === null || v === "" ? undefined : Math.min(Math.max(round2(Number(v)) || 0, 0), max));
  const p = {
    name: input.name ? String(input.name).trim().slice(0, 30) : undefined,
    goalName: input.goal_name ? ((g) => g.charAt(0).toUpperCase() + g.slice(1))(String(input.goal_name).trim().slice(0, 40)) : undefined,
    goalTarget: num(input.goal_target, 1000000),
    currentSavings: num(input.current_savings, 1000000),
    monthlyIncome: num(input.monthly_income, 1000000),
    monthlySavingsPace: num(input.monthly_savings_pace, 100000),
    monthlyFunBudget: num(input.monthly_fun_budget, 100000),
  };
  // Zero is a real answer for pace, savings and fun budget ("I can't save right now"); not for a target or income.
  const zeroOk = new Set(["monthlySavingsPace", "monthlyFunBudget", "currentSavings"]);
  for (const k of Object.keys(p)) if (p[k] === undefined || (p[k] === 0 && !zeroOk.has(k))) delete p[k];
  if (!Object.keys(p).length) throw new Error("Nothing to set up yet. Ask the user about their goal, savings pace or fun budget.");
  getDb().pendingSetup = { ...p, proposedAt: new Date().toISOString() };
  save();
  notify({ type: "setup", setup: getDb().pendingSetup });
  return { status: "shown to the user for confirmation, not saved yet", proposal: p };
}

export function confirmSetup() {
  const db = getDb();
  const p = db.pendingSetup;
  if (!p) throw new Error("Nothing to confirm");
  const u = db.user;
  if (p.name) u.name = p.name;
  if (p.monthlyIncome) u.monthlyIncome = p.monthlyIncome;
  if (p.monthlySavingsPace !== undefined) u.monthlySavingsPace = p.monthlySavingsPace;
  if (p.monthlyFunBudget !== undefined) u.monthlyFunBudget = p.monthlyFunBudget;
  let pond = db.ponds.find((x) => x.id === db.activePondId) || db.ponds[0];
  if (p.goalName || p.goalTarget || p.currentSavings !== undefined) {
    if (pond.placeholder) {
      // Fresh profile: the placeholder becomes the user's own goal.
      Object.assign(pond, { name: p.goalName || pond.name, target: p.goalTarget || pond.target, placeholder: false });
    } else if (p.goalName && p.goalName.toLowerCase() !== pond.name.toLowerCase()) {
      pond = { id: id("pond"), name: p.goalName, target: p.goalTarget || 500, balance: 0, pendingWithdrawal: 0, createdAt: new Date().toISOString() };
      db.ponds.push(pond);
      db.activePondId = pond.id;
    } else if (p.goalTarget) pond.target = p.goalTarget;
    // What they've already saved elsewhere is recorded as a declared starting point, not a PayPal balance.
    if (p.currentSavings !== undefined && pond.balance === 0) {
      pond.balance = p.currentSavings;
      pond.startingBalance = { amount: p.currentSavings, source: "you told Pondr" };
    }
  }
  db.pendingSetup = null;
  db.setupConfirmedAt = new Date().toISOString();
  u.setupNeeded = false;
  save();
  log("pond", `Settings confirmed: ${[p.goalName && `goal ${p.goalName}`, p.goalTarget && `€${p.goalTarget} target`, p.currentSavings !== undefined && `€${p.currentSavings} already saved (you told Pondr)`, p.monthlySavingsPace !== undefined && `€${p.monthlySavingsPace}/month saving`, p.monthlyFunBudget !== undefined && `€${p.monthlyFunBudget} fun budget`].filter(Boolean).join(", ")}`);
  return db.user;
}

export function createMandate({ product_id, max_price, deadline_days, cool_off_hours, min_pond_progress_pct }) {
  const item = product(product_id);
  if (!item) throw new Error(`No store product with id ${product_id}`);
  const maxPrice = round2(Number(max_price));
  if (!(maxPrice > 0) || maxPrice > item.listPrice) throw new Error(`max_price must be between 0 and the list price €${item.listPrice}`);
  const days = Math.min(Math.max(Number(deadline_days) || 30, 1), 365);
  const coolOff = cool_off_hours === undefined || cool_off_hours === null || cool_off_hours === "" ? 24 : Math.min(Math.max(Number(cool_off_hours) || 0, 0), 168);
  const now = Date.now();
  const mandate = {
    id: id("watch"),
    productId: item.id,
    productName: item.name,
    originalPrice: item.price, // price when the watch started; used for "€X under your starting price"
    maxPrice,
    deadline: new Date(now + days * 86400000).toISOString(),
    coolOffHours: coolOff,
    coolOffUntil: new Date(now + coolOff * 3600000).toISOString(),
    minPondProgressPct: min_pond_progress_pct ? Math.min(Math.max(Number(min_pond_progress_pct), 0), 100) : 0,
    merchant: "Pondr Demo Store",
    pondId: activePond().id, // the goal this watch protects; never changes with the active pond
    status: "watching",
    createdAt: new Date(now).toISOString(),
  };
  getDb().mandates.unshift(mandate);
  mandateEvent(mandate, "created", `Watch created: at most €${maxPrice}, ${coolOff}h cooling-off, within ${days} days${mandate.minPondProgressPct ? `, once ${activePond().name} ≥ ${mandate.minPondProgressPct}%` : ""}. Bought only from Pondr Demo Store.`);
  save();
  log("watch", `Watching ${item.name}: at most €${maxPrice}, ${coolOff}h cooling-off, within ${days} days`);
  return mandate;
}

// The user changed their mind. Not buying is a fine outcome, never a failure.
export function releaseMandate(mandate) {
  const db = getDb();
  if (["released", "fulfilled", "cancelled", "expired"].includes(mandate.status)) return mandate;
  const inFlight = db.payments.find((p) => p.id === mandate.paymentId && ["capturing", "processing", "unknown"].includes(p.status));
  if (inFlight) throw new Error("This payment is already being completed with PayPal.");
  const pay = db.payments.find((p) => p.id === mandate.paymentId && p.status === "awaiting_approval");
  if (pay) Object.assign(pay, { status: "cancelled", error: "You let this watch go." });
  mandate.status = "released";
  mandate.releasedAt = new Date().toISOString();
  mandateEvent(mandate, "released", "You let it go. Nothing spent.");
  save();
  log("released", `Let go of ${mandate.productName}. €${product(mandate.productId)?.price ?? mandate.maxPrice} stays free.`);
  return mandate;
}

async function runChatTool(name, input) {
  const db = getDb();
  switch (name) {
    case "get_finances":
      return financeSnapshot();
    case "list_store_products":
      return db.products.map(({ id, name, category, price }) => ({ id, name, category, price }));
    case "search_market":
      return searchMarket(input.query, { maxPrice: input.max_price });
    case "create_watch":
      return createMandate(input);
    case "propose_setup":
      return proposeSetup(input);
    case "list_watches":
      return db.mandates.map(({ id, productName, maxPrice, deadline, status, lastNote }) => ({ id, productName, maxPrice, deadline, status, lastNote }));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export async function chat(userText) {
  const db = getDb();
  db.chat.push({ role: "user", text: userText, at: new Date().toISOString() });
  let reply;
  let trace = [];
  let source = "ai";
  try {
    const history = db.chat.slice(-12).map((m) => ({ role: m.role, content: m.text }));
    const recent = db.activity.slice(0, 6).map((a) => `- ${a.at.slice(0, 16).replace("T", " ")}: ${a.text}`).join("\n");
    const result = await runAgent({
      system: `${PERSONA}
USER: ${db.user.name}. GOAL: ${(db.ponds.find((x) => x.id === db.activePondId) || db.ponds[0]).name} (target €${(db.ponds.find((x) => x.id === db.activePondId) || db.ponds[0]).target}).
SAVED SETTINGS (already confirmed): saving €${db.user.monthlySavingsPace}/month, fun budget €${db.user.monthlyFunBudget}/month, income €${db.user.monthlyIncome}/month.
PENDING CARD: ${db.pendingSetup ? "yes, waiting for the user to confirm" : "none; nothing is waiting for confirmation"}.${db.user.setupNeeded ? "\nSETUP NEEDED: this is a new profile with no goal or settings yet." : ""}
RECENT ACTIVITY (verified records, newest first):
${recent}
You can look up the user's finances, the demo store and live market prices, and set up Wait & Watch mandates.
Get to know the user like a friend would: what they are saving for, what they have already saved, roughly what comes in, how much they can put aside each month (zero is a fine answer), and how much they want to keep for fun. If the profile is new (SETUP NEEDED), start by asking about their goal. When they tell you any of this, call propose_setup and tell them to confirm the card. Never say settings are saved until they confirm.
Refer to things the user actually did (RECENT ACTIVITY below) when relevant, e.g. a recent pond or purchase. Never invent past events.
When the user says they want something "cheaper", "later" or "when I can afford it", offer or create a watch.
Pondr can only buy from the Pondr Demo Store; market prices from other retailers are for comparison only.
Never pressure the user to buy. Deciding not to buy is a good outcome.
Keep replies under 80 words. Plain text only: no markdown, no emoji.`,
      messages: history,
      tools: CHAT_TOOLS,
      runTool: runChatTool,
      effort: "low",
    });
    reply = result.text;
    trace = result.trace;
  } catch (err) {
    if (!(err instanceof AIUnavailable)) console.error("chat:", err.message);
    ({ reply, trace } = mockChat(userText));
    source = "template";
  }
  db.chat.push({ role: "assistant", text: reply, source, at: new Date().toISOString(), tools: trace.map((t) => t.tool) });
  db.chat = db.chat.slice(-40);
  save();
  return { reply, trace, source };
}

function mockChat(text) {
  const t = text.toLowerCase();
  const db = getDb();
  const match = db.products.find((p) => p.impulse && p.name.toLowerCase().split(" ").some((w) => w.length > 3 && t.includes(w)));
  const price = Number((t.match(/(\d+(?:\.\d+)?)/) || [])[1]);
  if (match && price) {
    const m = createMandate({ product_id: match.id, max_price: price });
    return { reply: `Deal. I'll watch the ${match.name} and line up a PayPal purchase for you to approve once it's €${m.maxPrice} or less.`, trace: [{ tool: "create_watch" }] };
  }
  const f = financeSnapshot();
  return {
    reply: `(Demo mode) Your ${f.pond.name} is at €${f.pond.balance} of €${f.pond.target} (${f.pond.progressPct}%). You've spent €${f.spentLast30} in the last 30 days, including €${f.recurringCharges.reduce((s, r) => s + r.amount, 0).toFixed(2)} in recurring charges. Try: "watch the headphones for 75".`,
    trace: [{ tool: "get_finances" }],
  };
}

// ---------- 3. Wait & Watch agent ----------
const WATCH_TOOLS = [
  {
    name: "search_market",
    description: "Check live market prices across retailers (Channel3) to judge whether the store price is a good deal.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  },
  {
    name: "prepare_purchase",
    description:
      "Create a PayPal order for the watched product at its current store price and send it to the user for one-tap approval. The user must approve in PayPal; you cannot complete payment yourself.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "1-2 sentences for the user explaining why now is a good time" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "keep_watching",
    description: "Decide not to buy yet and keep watching.",
    input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false },
  },
];

// Store a market check with its source and retrieval time so the UI can show provenance.
async function checkMarket(mandate, query) {
  const market = await searchMarket(query, { maxPrice: mandate.maxPrice * 1.5 }).catch(() => ({ source: "unavailable", results: [] }));
  mandate.market = { source: market.source, retrievedAt: new Date().toISOString(), storeCurrency: market.storeCurrency, results: market.results.slice(0, 3) };
  const same = mandate.market.results.filter((r) => r.currency === market.storeCurrency);
  mandateEvent(mandate, "market", `Checked ${mandate.market.results.length} similar items (${market.source === "channel3" ? "Channel3" : market.source === "mock" ? "demo data" : market.source})${same.length ? `, ${same.length} in ${market.storeCurrency}` : ", none in the store currency"}. Comparison only; specs and shipping not compared.`);
  return market;
}

export async function evaluateMandate(mandate) {
  const item = product(mandate.productId);
  const cond = mandateConditions(mandate, item.price);
  if (!cond.notExpired) {
    mandate.status = "expired";
    mandate.lastNote = "Watch ended without a purchase. That's a fine outcome.";
    save();
    log("expired", `Watch ended for ${mandate.productName}. Nothing bought, nothing spent.`);
    mandateEvent(mandate, "expired", "Deadline passed without a purchase. Nothing spent.");
    return { action: "expired" };
  }
  if (!cond.all) {
    // Explain what is holding the purchase back (only when it changes, to avoid noise).
    const note = cond.blockers[0] || null;
    if (note !== (mandate.lastNote ?? null)) {
      mandate.lastNote = note;
      if (note && cond.priceOk) mandateEvent(mandate, "waiting", note);
      save();
      if (note && cond.priceOk) {
        log("waiting", `${mandate.productName}: ${note}`);
        notify({ type: "waiting", mandate, note });
      }
    }
    return { action: "waiting", cond };
  }

  mandate.status = "evaluating";
  mandate.evaluatingSince = new Date().toISOString();
  save();

  // Guarded server-side action: the only way the agent can move toward money movement.
  // Re-checks every rule at the moment of preparing the order.
  const preparePurchase = async (summary) => {
    const current = product(mandate.productId).price;
    const again = mandateConditions(mandate, current);
    if (!again.all) throw new Error(again.blockers[0] || "Mandate conditions no longer met");
    if (mandate.status !== "evaluating") throw new Error("Watch is no longer active");
    const payment = await startOrder({
      kind: "mandate",
      amount: current,
      description: `Pondr agent purchase: ${mandate.productName}`,
      productId: mandate.productId,
      mandateId: mandate.id,
    });
    // The user may have let the watch go while PayPal was creating the order.
    if (mandate.status !== "evaluating") {
      payment.status = "cancelled";
      payment.error = "Watch was released before the order was ready.";
      save();
      throw new Error("Watch is no longer active");
    }
    // Decision receipt: every number and rule outcome comes from code, not from the AI.
    const pond = pondFor(mandate);
    const sameCur = (mandate.market?.results || []).filter((r) => r.currency === (mandate.market?.storeCurrency || "EUR"));
    const receipt = {
      checkedAt: new Date().toISOString(),
      merchant: mandate.merchant,
      price: current,
      maxPrice: mandate.maxPrice,
      startingPrice: mandate.originalPrice,
      coolOffHours: mandate.coolOffHours,
      budget: { monthly: again.budget.budget, spent: again.budget.spent, heldForOtherOrders: again.budget.committed, available: again.budget.remaining, thisPurchase: current, remainingAfter: round2(again.budget.remaining - current) },
      goal: { name: pond.name, progressPct: Math.round((pond.balance / pond.target) * 100), rulePct: mandate.minPondProgressPct || 0, untouched: true },
      market: mandate.market ? { source: mandate.market.source, retrievedAt: mandate.market.retrievedAt, similarItems: mandate.market.results.length, bestSameCurrency: sameCur.length ? Math.min(...sameCur.map((r) => r.price)) : null } : null,
    };
    Object.assign(mandate, { status: "awaiting_approval", paymentId: payment.id, summary, foundPrice: current, lastNote: null, receipt, evaluatingSince: null });
    mandateEvent(mandate, "prepared", `All rules met. PayPal order prepared for €${current}; €${receipt.budget.remainingAfter} of the fun budget left after. Waiting for your approval.`, { orderId: payment.orderId });
    save();
    log("ready", `Your rules are met for ${mandate.productName} at €${current}. Waiting for your approval.`);
    notify({ type: "ready", mandate, payment });
    return { approvalLink: `/approve.html?payment=${payment.id}` };
  };

  const facts = {
    mandate: { product: mandate.productName, maxPrice: mandate.maxPrice, startingPrice: mandate.originalPrice, deadline: mandate.deadline, merchant: mandate.merchant },
    currentStorePrice: item.price,
    belowStartingPrice: round2(mandate.originalPrice - item.price),
    funBudget: cond.budget,
    daysOfSaving: daysOfSaving(item.price),
    goalPond: (({ name, balance, target }) => ({ name, balance, target, progressPct: Math.round((balance / target) * 100) }))(pondFor(mandate)),
    searchQuery: item.searchQuery,
  };

  try {
    let decided = null;
    await runAgent({
      system: `${PERSONA}
You are running a Wait & Watch mandate the user created. All of the user's rules (price, cooling-off, fun budget, goal) are already met.
Pondr can only buy from the Pondr Demo Store. Market prices from other retailers are comparison only.
Check the market once with search_market. Market results are similar products, not necessarily the identical item; describe them as similar. Only offers in the store currency (EUR) can be compared with the store price; never treat USD or other currencies as euros. Then either prepare_purchase (if the store price is fair) or keep_watching (only if a clearly comparable EUR offer is much cheaper). A cheaper similar item is not proof the watched item is overpriced; specs and shipping are not compared.
In the summary, state facts only: the price, that it fits the fun budget, and what the market check found. Do not call it a good deal or a bargain, and do not claim the item is fairly priced; the user decides. Never use urgency or pressure; remind the user they can say no.
Call exactly one of prepare_purchase or keep_watching.`,
      messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}` }],
      tools: WATCH_TOOLS,
      effort: "medium",
      runTool: async (name, input) => {
        if (name === "search_market") return checkMarket(mandate, input.query || item.searchQuery);
        if (decided) throw new Error("A decision was already made");
        if (name === "prepare_purchase") {
          decided = "prepared";
          const r = await preparePurchase(String(input.summary || "").slice(0, 400));
          mandate.summarySource = "ai";
          save();
          return r;
        }
        if (name === "keep_watching") {
          decided = "waiting";
          if (mandate.status !== "evaluating") return { ok: false };
          mandate.status = "watching";
          mandate.lastNote = String(input.reason || "Keeping watch.").slice(0, 300);
          save();
          return { ok: true };
        }
        throw new Error(`Unknown tool ${name}`);
      },
    });
    // Report what actually happened (a failed prepare_purchase tool call leaves the watch evaluating).
    if (mandate.status === "evaluating") {
      mandate.status = "watching";
      save();
    }
    return { action: mandate.status === "awaiting_approval" ? "prepared" : mandate.status };
  } catch (err) {
    if (!(err instanceof AIUnavailable)) console.error("evaluateMandate:", err.message);
    if (mandate.status !== "evaluating") return { action: mandate.status }; // prepared already, or released meanwhile
    try {
      const market = mandate.market?.results ? mandate.market : await checkMarket(mandate, item.searchQuery);
      const prices = market.results.filter((r) => r.currency === market.storeCurrency).map((r) => r.price).filter(Boolean);
      const best = prices.length ? Math.min(...prices) : null;
      const other = !best && market.results.length ? "; market offers I found were in other currencies, so I didn't compare them" : "";
      const left = round2(cond.budget.remaining - item.price);
      await preparePurchase(
        `It's €${item.price} now, €${facts.belowStartingPrice} under the price when you started watching${best ? `; the best similar offer I found elsewhere was €${best}` : other}. It fits your fun budget (€${left} left after). Still want it? Saying no is fine too.`
      );
      mandate.summarySource = "template";
      save();
      return { action: "prepared" };
    } catch (inner) {
      if (mandate.status !== "evaluating") return { action: mandate.status };
      mandate.status = "watching";
      mandate.lastNote = `Couldn't prepare the purchase: ${inner.message}`;
      save();
      return { action: "error" };
    }
  }
}

const ticking = new Set();
// Evaluates all open watches for the current session.
export async function watchTick() {
  const db = getDb();
  if (ticking.has(db)) return;
  ticking.add(db);
  try {
    // Recover watches interrupted mid-evaluation (e.g. a server restart).
    for (const m of db.mandates.filter((x) => x.status === "evaluating" && (!x.evaluatingSince || Date.now() - new Date(x.evaluatingSince).getTime() > 180000))) {
      Object.assign(m, { status: "watching", evaluatingSince: null });
      mandateEvent(m, "recovered", "A check was interrupted; Pondr resumed watching.");
      save();
    }
    for (const m of db.mandates.filter((x) => x.status === "watching")) {
      await evaluateMandate(m);
    }
  } finally {
    ticking.delete(db);
  }
}
