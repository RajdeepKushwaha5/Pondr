// Deterministic money math. The AI never computes or invents these numbers.
import { getDb, activePond } from "./store.js";

export const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;
const within30 = (iso) => Date.now() - new Date(iso).getTime() <= 30 * DAY;

export function dailyPace() {
  return getDb().user.monthlySavingsPace / 30;
}

// Exact days of saving at the user's stated pace; null when no pace is set (don't invent an estimate).
export function daysExact(amount) {
  const pace = dailyPace();
  if (!pace || pace <= 0) return null;
  return amount / pace;
}

// Display value: whole days, or 0 meaning "less than a day". Thresholds use daysExact, not this.
export function daysOfSaving(amount) {
  const d = daysExact(amount);
  if (d === null) return null;
  return d < 1 ? 0 : Math.round(d);
}

export function spendLast30(category) {
  return round2(
    getDb()
      .transactions.filter((t) => within30(t.date) && (!category || t.category === category))
      .reduce((s, t) => s + t.amount, 0)
  );
}

export function recurringCharges() {
  return getDb().transactions.filter((t) => t.recurring);
}

// ---------- Fun budget: the user's own declared spending money for wants ----------
// remaining = declared budget − discretionary spend (last 30 days) − purchases still in flight.
// A purchase stays reserved from preparation through capture, pending processing and unknown
// network outcomes; it is released only on a confirmed terminal state (completed → counted as
// spend, or cancelled/failed → freed).
export const RESERVING = ["created", "awaiting_approval", "capturing", "processing", "unknown", "unresolved"];
export function budgetSnapshot({ excludePaymentId } = {}) {
  const db = getDb();
  const quiet = new Set(db.user.quietCategories);
  const spent = round2(db.transactions.filter((t) => within30(t.date) && !quiet.has(t.category)).reduce((s, t) => s + t.amount, 0));
  const committed = round2(
    db.payments.filter((p) => (p.kind === "mandate" || p.kind === "buy") && RESERVING.includes(p.status) && p.id !== excludePaymentId).reduce((s, p) => s + p.amount, 0)
  );
  const budget = db.user.monthlyFunBudget;
  return { budget, spent, committed, remaining: round2(budget - spent - committed) };
}

// Facts handed to the AI. Everything here is computed by code.
export function financeSnapshot(amount, item) {
  const pond = activePond();
  const db = getDb();
  return {
    user: db.user.name,
    pond: { name: pond.name, balance: pond.balance, target: pond.target, remaining: round2(pond.target - pond.balance), progressPct: Math.round((pond.balance / pond.target) * 100) },
    monthlySavingsPace: db.user.monthlySavingsPace,
    funBudget: budgetSnapshot(),
    item: item ? { name: item.name, category: item.category, price: amount } : undefined,
    daysOfSaving: amount ? daysOfSaving(amount) : undefined,
    daysExact: amount ? daysExact(amount) : undefined,
    savingPaceSource: db.setupConfirmedAt ? "you told Pondr" : "demo profile",
    pondProgressIfPonded: amount ? Math.round(((pond.balance + amount) / pond.target) * 100) : undefined,
    // Outcomes of each choice, computed here so the AI never has to do arithmetic.
    ifBuyNow: amount ? { goalBalanceAfter: pond.balance, goalUnchanged: true, funBudgetLeftAfter: round2(budgetSnapshot().remaining - amount) } : undefined,
    ifPondIt: amount ? { goalBalanceAfter: round2(pond.balance + amount), goalProgressPctAfter: Math.round(((pond.balance + amount) / pond.target) * 100), funBudgetUnchanged: true } : undefined,
    spentLast30: spendLast30(),
    spentLast30ByCategory: Object.fromEntries([...new Set(db.transactions.filter((t) => within30(t.date)).map((t) => t.category))].map((c) => [c, spendLast30(c)])),
    essentialCategories: db.user.quietCategories,
    spentLast30SameCategory: item ? spendLast30(item.category) : undefined,
    recurringCharges: recurringCharges().map((t) => ({ merchant: t.merchant, amount: t.amount })),
    localHour: new Date().getHours(),
  };
}

// Every rule of a Wait & Watch mandate, with a human-readable reason for each one that fails.
// The agent may only prepare a purchase when all of them hold; they are re-checked at approval.
// A watch is bound to the goal it was created for, not whichever pond is active now.
export const pondFor = (mandate) => getDb().ponds.find((p) => p.id === mandate?.pondId) || activePond();

export function mandateConditions(mandate, currentPrice, { excludePaymentId } = {}) {
  const pond = pondFor(mandate);
  const budget = budgetSnapshot({ excludePaymentId });
  const now = Date.now();
  const progress = (pond.balance / pond.target) * 100;
  const c = {
    priceOk: currentPrice <= mandate.maxPrice,
    notExpired: !mandate.deadline || new Date(mandate.deadline).getTime() >= now,
    coolOffOk: !mandate.coolOffUntil || new Date(mandate.coolOffUntil).getTime() <= now,
    pondOk: !mandate.minPondProgressPct || progress >= mandate.minPondProgressPct,
    budgetOk: budget.remaining >= currentPrice,
    budget,
  };
  c.blockers = [];
  if (!c.priceOk) c.blockers.push(`Price is €${currentPrice}, above your max of €${mandate.maxPrice}.`);
  if (c.priceOk && !c.coolOffOk) {
    const hrs = Math.max(1, Math.ceil((new Date(mandate.coolOffUntil).getTime() - now) / 3600000));
    c.blockers.push(`Price is right, but you asked for a cooling-off period. ${hrs}h to go.`);
  }
  if (c.priceOk && !c.budgetOk) c.blockers.push(`Price is right, but your fun budget only has €${Math.max(0, budget.remaining)} left this month.`);
  if (c.priceOk && !c.pondOk) c.blockers.push(`Price is right, but ${pond.name} is at ${Math.round(progress)}%, below your ${mandate.minPondProgressPct}% rule.`);
  c.all = c.priceOk && c.notExpired && c.coolOffOk && c.pondOk && c.budgetOk;
  return c;
}
