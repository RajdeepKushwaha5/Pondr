// Per-visitor demo sessions, persisted as JSON files. Each browser gets its own
// "Ana", so judges using the hosted demo at the same time never collide.
// Request handlers run inside withSession(); getDb() returns that visitor's data.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SESS_DIR = path.join(here, "..", "data", "sessions");
const MAX_AGE_MS = 14 * 86400000;

export const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
export const newSessionId = () => crypto.randomBytes(12).toString("hex");
export const validSessionId = (sid) => typeof sid === "string" && /^[a-f0-9]{24}$/.test(sid);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

export function seed() {
  return {
    user: {
      id: "user_ana",
      name: "Ana",
      age: 22,
      monthlyIncome: 1400,
      // Ana's stated saving pace toward her goals; drives "days of saving".
      monthlySavingsPace: 300,
      // User-declared spending money for wants, per rolling 30 days. Agent purchases must fit inside it.
      monthlyFunBudget: 260,
      quietCategories: ["groceries", "rent", "utilities", "health", "subscriptions"],
    },
    ponds: [{ id: "pond_apartment", name: "Apartment fund", target: 600, balance: 140, pendingWithdrawal: 0, createdAt: daysAgo(40) }],
    activePondId: "pond_apartment",
    products: [
      { id: "p_headphones", name: "Aurora ANC Headphones", blurb: "Over-ear, 40h battery, adaptive noise cancelling.", category: "electronics", price: 89, listPrice: 89, art: "headphones", impulse: true, searchQuery: "wireless noise cancelling headphones" },
      { id: "p_sneakers", name: "Cloudstep Runners", blurb: "Featherweight foam, made for the long way home.", category: "fashion", price: 120, listPrice: 120, art: "sneakers", impulse: true, searchQuery: "running sneakers" },
      { id: "p_lamp", name: "Halo Desk Lamp", blurb: "Warm dimmable light with a brass-finish stem.", category: "home", price: 45, listPrice: 45, art: "lamp", impulse: true, searchQuery: "led desk lamp" },
      { id: "p_groceries", name: "Weekly Groceries Box", blurb: "Seasonal produce and pantry staples for one.", category: "groceries", price: 38, listPrice: 38, art: "groceries", impulse: false, searchQuery: "grocery box" },
    ],
    // Seeded history so insights work without linking real accounts. Labelled as demo data in the UI.
    transactions: [
      { id: "t1", date: daysAgo(2), merchant: "Night Owl Gadgets", category: "electronics", amount: 64, demo: true },
      { id: "t2", date: daysAgo(4), merchant: "StreamFlix", category: "subscriptions", amount: 12.99, recurring: true, demo: true },
      { id: "t3", date: daysAgo(6), merchant: "FreshCart", category: "groceries", amount: 41.2, demo: true },
      { id: "t4", date: daysAgo(9), merchant: "Trendy Threads", category: "fashion", amount: 79, demo: true },
      { id: "t5", date: daysAgo(11), merchant: "CloudGym", category: "subscriptions", amount: 24.99, recurring: true, demo: true },
      { id: "t6", date: daysAgo(13), merchant: "Night Owl Gadgets", category: "electronics", amount: 35, demo: true },
      { id: "t7", date: daysAgo(17), merchant: "MusicBox", category: "subscriptions", amount: 9.99, recurring: true, demo: true },
      { id: "t8", date: daysAgo(20), merchant: "FreshCart", category: "groceries", amount: 37.5, demo: true },
    ],
    mandates: [],
    payments: [],
    activity: [{ id: id("act"), at: daysAgo(40), kind: "pond", text: "Ana created the Apartment fund pond" }],
    chat: [],
    subscription: null,
    processedEvents: [],
  };
}

const als = new AsyncLocalStorage();
const sessions = new Map(); // sid -> { sid, db, touched }
const file = (sid) => path.join(SESS_DIR, `${sid}.json`);

// Load recent sessions at startup so PayPal webhooks and the watcher can find them.
try {
  for (const name of fs.readdirSync(SESS_DIR)) {
    const sid = name.replace(/\.json$/, "");
    if (!validSessionId(sid)) continue;
    const stat = fs.statSync(file(sid));
    if (Date.now() - stat.mtimeMs > MAX_AGE_MS) continue;
    sessions.set(sid, { sid, db: JSON.parse(fs.readFileSync(file(sid), "utf8")), touched: stat.mtimeMs });
  }
} catch {
  /* no sessions yet */
}

function session(sid) {
  if (!validSessionId(sid)) throw new Error("Invalid session");
  let s = sessions.get(sid);
  if (!s) {
    s = { sid, db: seed(), touched: Date.now() };
    sessions.set(sid, s);
  }
  s.touched = Date.now();
  return s;
}

export const withSession = (sid, fn) => als.run(session(sid), fn);
export const sessionIds = () => [...sessions.keys()];

function current() {
  const s = als.getStore();
  if (!s) throw new Error("No active demo session");
  return s;
}

export const getDb = () => current().db;

export function save() {
  const s = current();
  fs.mkdirSync(SESS_DIR, { recursive: true });
  fs.writeFileSync(file(s.sid), JSON.stringify(s.db, null, 2));
}

export function reset() {
  current().db = seed();
  save();
  return getDb();
}

// Find which visitor owns a PayPal order (webhooks arrive without a cookie).
export function sessionForOrder(orderId) {
  for (const s of sessions.values()) if (s.db.payments.some((p) => p.orderId === orderId)) return s.sid;
  return null;
}
// PayPal's redirect back can arrive without our cookie (cross-site navigation), so
// return/cancel URLs locate the owner by the unguessable payment id instead.
export function sessionForPayment(paymentId) {
  for (const s of sessions.values()) if (s.db.payments.some((p) => p.id === paymentId)) return s.sid;
  return null;
}
export function sessionForSubscription(subId) {
  for (const s of sessions.values()) if (s.db.subscription?.id === subId) return s.sid;
  return null;
}

export function log(kind, text) {
  const db = getDb();
  db.activity.unshift({ id: id("act"), at: new Date().toISOString(), kind, text });
  db.activity = db.activity.slice(0, 100);
  save();
}

// Append a step to a watch's timeline (accepts the mandate or its id). Deterministic data only.
export function mandateEvent(mandateOrId, kind, text, data) {
  if (!mandateOrId) return;
  const m = typeof mandateOrId === "string" ? getDb().mandates.find((x) => x.id === mandateOrId) : mandateOrId;
  if (!m) return;
  m.events ||= [];
  m.events.push({ at: new Date().toISOString(), kind, text, ...(data ? { data } : {}) });
  m.events = m.events.slice(-30);
}

export const activePond = () => {
  const db = getDb();
  return db.ponds.find((p) => p.id === db.activePondId) || db.ponds[0];
};
export const product = (pid) => getDb().products.find((p) => p.id === pid);
