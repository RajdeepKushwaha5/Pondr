// Telegram companion: the duck on your phone. Speaks first when something happens,
// lets you approve / say not now / let it go, chat, check in, and pond from the phone.
// Uses long polling (no public webhook needed). Off when TELEGRAM_BOT_TOKEN is missing.
import crypto from "node:crypto";
import { getDb, save, log, withSession, sessionForTelegramChat, onNotify, currentSid, activePond, unlinkTelegramElsewhere } from "./store.js";
import { chat, releaseMandate, confirmSetup, createMandate } from "./agent.js";
import { startOrder, cancel, findPayment } from "./payments.js";
import { round2 } from "./money.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const telegram = { mode: TOKEN ? "live" : "off", botUsername: null };
const linkCodes = new Map(); // code -> { sid, expires }

async function tg(method, body, timeoutMs = 15000) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

// rows: [[{ text, url } | { text, data }]]
function send(chatId, text, rows) {
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (rows?.length) {
    body.reply_markup = {
      inline_keyboard: rows.map((r) => r.filter(Boolean).map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))).filter((r) => r.length),
    };
  }
  // Resolves true when Telegram accepted the message, false otherwise (never throws).
  return tg("sendMessage", body).then(
    () => true,
    (e) => {
      console.error(e.message);
      return false;
    }
  );
}

// Send to the linked user and record a failure in their activity feed.
function deliver(chatId, text, rows) {
  return send(chatId, text, rows).then((ok) => {
    if (!ok) log("failed", "Couldn't deliver a Telegram message to your phone.");
    return ok;
  });
}

// Telegram only accepts real http(s) URLs on buttons; mock-mode PayPal pages are relative.
const payUrl = (p) => (p?.approveUrl?.startsWith("https://") ? p.approveUrl : null);
const eur = (n) => `€${Number(n).toFixed(2).replace(/\.00$/, "")}`;

// ---------- Linking (one-time code, no passwords in chat) ----------
export function createLinkCode() {
  if (telegram.mode !== "live") throw new Error("Telegram isn't configured on this server (TELEGRAM_BOT_TOKEN missing).");
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  linkCodes.set(code, { sid: currentSid(), expires: Date.now() + 10 * 60000 });
  return { code, url: telegram.botUsername ? `https://t.me/${telegram.botUsername}?start=${code}` : null, bot: telegram.botUsername, expiresInMin: 10 };
}

export function telegramStatus() {
  const t = getDb().telegram;
  return { mode: telegram.mode, bot: telegram.botUsername, linked: !!t, name: t?.firstName || null, linkedAt: t?.linkedAt || null, checkins: t?.checkins || { every: "off" } };
}

export function unlinkTelegram() {
  const db = getDb();
  const chatId = db.telegram?.chatId;
  db.telegram = null;
  save();
  if (chatId) send(chatId, "Disconnected from Pondr. Link again any time from the dashboard.");
}

// ---------- The duck speaks first ----------
export function checkinMessage() {
  const db = getDb();
  const pond = activePond();
  const pct = Math.round((pond.balance / pond.target) * 100);
  const perDay = db.user.monthlySavingsPace / 30;
  const daysLeft = perDay > 0 ? Math.ceil(Math.max(0, pond.target - pond.balance) / perDay) : null;
  const step = Math.max(5, Math.round(perDay * 2));
  return {
    text: `Check-in on your ${pond.name}: ${eur(pond.balance)} of ${eur(pond.target)} (${pct}%).${daysLeft !== null ? ` About ${daysLeft} days to go at your pace.` : ""}\nOne easy step: pond ${eur(step)} now, before the weekend spending starts?`,
    rows: [[{ text: `Pond ${eur(step)} now`, data: `pond:${step}` }], [{ text: "Not today", data: "noop" }]],
  };
}

export async function sendCheckin({ scheduled = false } = {}) {
  const t = getDb().telegram;
  if (!t) throw new Error("Connect Telegram first.");
  const { text, rows } = checkinMessage();
  const ok = await send(t.chatId, text, rows);
  if (!ok) {
    log("failed", "Check-in couldn't be delivered to Telegram.");
    throw new Error("Couldn't reach your phone on Telegram. Is the bot still running?");
  }
  log("checkin", scheduled ? "Pondr checked in on Telegram (your scheduled check-in)" : "Pondr sent you a check-in on Telegram");
  return true;
}

// ---------- Opt-in scheduled check-ins ----------
const EVERY_MS = { daily: 86400000, weekly: 7 * 86400000 };
export function setCheckins(every) {
  const t = getDb().telegram;
  if (!t) throw new Error("Connect Telegram first.");
  if (!["off", "daily", "weekly"].includes(every)) throw new Error("Choose off, daily or weekly");
  t.checkins = every === "off" ? { every: "off" } : { every, nextAt: new Date(Date.now() + EVERY_MS[every]).toISOString() };
  save();
  log("checkin", every === "off" ? "Scheduled check-ins turned off" : `Scheduled check-ins: ${every}`);
  return t.checkins;
}
// Called by the background loop inside each session.
export async function runDueCheckins() {
  const t = getDb().telegram;
  if (!t?.checkins?.nextAt || telegram.mode !== "live") return;
  if (new Date(t.checkins.nextAt).getTime() > Date.now()) return;
  t.checkins.nextAt = new Date(Date.now() + EVERY_MS[t.checkins.every]).toISOString();
  save();
  await sendCheckin({ scheduled: true }).catch(() => {});
}

onNotify((e) => {
  const t = getDb().telegram;
  if (!t || telegram.mode !== "live") return;
  const send = deliver; // record delivery failures for event notifications
  const pond = activePond();
  switch (e.type) {
    case "ready": {
      const r = e.mandate.receipt?.budget;
      const url = payUrl(e.payment);
      send(
        t.chatId,
        `Your rules are met: ${e.mandate.productName} is ${eur(e.payment.amount)} (max ${eur(e.mandate.maxPrice)}).${r ? ` Fun budget after: ${eur(r.remainingAfter)}.` : ""}\n${e.mandate.summary || ""}\nStill want it?`,
        [[url && { text: `Yes, approve ${eur(e.payment.amount)} in PayPal`, url }], [{ text: "Not now", data: `notnow:${e.payment.id}` }, { text: "Let it go", data: `release:${e.mandate.id}` }]]
      );
      break;
    }
    case "waiting":
      send(t.chatId, `Watching ${e.mandate.productName}. ${e.note} I'll keep waiting.`, [[{ text: "Let it go", data: `release:${e.mandate.id}` }]]);
      break;
    case "ponded": {
      // Use the confirmed payment's own goal snapshot, never whichever goal is active now.
      const name = e.goalName || pond.name, after = e.balanceAfter ?? pond.balance, target = e.target ?? pond.target;
      send(
        t.chatId,
        `${e.item ? `You chose your ${name} over the ${e.item}. ` : ""}${eur(e.amount)} recorded toward it.\nNow ${eur(after)} of ${eur(target)} (${Math.round((after / target) * 100)}%). ${String(e.captureId).startsWith("MOCK") ? "Mock" : "PayPal sandbox"} capture ${e.captureId}.${e.item ? "\nWant me to keep an eye on it in case you still want it later?" : ""}`,
        e.productId ? [[{ text: "Keep an eye on it", data: `watchitem:${e.productId}` }, { text: "Let it go", data: "noop:letgo" }]] : null
      );
      break;
    }
    case "bought":
      send(t.chatId, `Done: ${e.item} for ${eur(e.amount)}, approved by you in PayPal${e.priceDrop ? `, ${eur(e.priceDrop)} under your starting price` : ""}. Capture ${e.captureId}.`);
      break;
    case "payout":
      send(t.chatId, `PayPal confirmed: ${eur(e.amount)} from ${e.pond?.name || "your pond"} was delivered to your PayPal.`);
      break;
    case "setup": {
      const s = e.setup;
      const lines = [s.name && `Name: ${s.name}`, s.goalName && `Goal: ${s.goalName}`, s.goalTarget && `Target: ${eur(s.goalTarget)}`, s.monthlyIncome && `Income: ${eur(s.monthlyIncome)}/month`, s.monthlySavingsPace && `Saving: ${eur(s.monthlySavingsPace)}/month`, s.monthlyFunBudget !== undefined && `Fun budget: ${eur(s.monthlyFunBudget)}/month`].filter(Boolean);
      send(t.chatId, `Here's what I'd save:\n${lines.join("\n")}`, [[{ text: "Confirm", data: "setup:confirm" }, { text: "Not right", data: "setup:dismiss" }]]);
      break;
    }
  }
});

// ---------- Incoming messages and buttons ----------
const HELP = "I'm Pondr, your money duck. Ask me anything about your spending, or try:\n/checkin  how my goal is doing\n/pond 20  put €20 toward my goal\n/watches  what I'm waiting for";

// Only the Telegram user who linked this session may act on it.
function isOwner(sid, fromId) {
  return withSession(sid, () => {
    const t = getDb().telegram;
    return !!t && (t.userId === undefined || t.userId === fromId);
  });
}

async function onMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  // Pondr is personal: private chats only, never groups or channels.
  if (msg.chat.type !== "private") return send(chatId, "Pondr only works in a private chat. Message me directly.");
  const start = text.match(/^\/start(?:\s+([A-F0-9]{8}))?$/i);
  if (start) {
    const entry = start[1] && linkCodes.get(start[1].toUpperCase());
    if (!entry || entry.expires < Date.now()) {
      return send(chatId, "Hi! To connect, open the Pondr dashboard and tap Connect Telegram. The link there includes a one-time code.");
    }
    linkCodes.delete(start[1].toUpperCase());
    unlinkTelegramElsewhere(chatId, entry.sid);
    await withSession(entry.sid, () => {
      getDb().telegram = { chatId, userId: msg.from?.id, firstName: msg.from?.first_name || null, linkedAt: new Date().toISOString() };
      save();
      log("pond", "Telegram connected. Pondr can message you first now.");
    });
    return send(chatId, `Connected. I'll message you when a watch is ready, when your budget says wait, and when PayPal confirms a payment.\n\n${HELP}`);
  }

  const sid = sessionForTelegramChat(chatId);
  if (!sid || !isOwner(sid, msg.from?.id)) return send(chatId, "This chat isn't connected yet. Open the Pondr dashboard and tap Connect Telegram.");

  return withSession(sid, async () => {
    if (/^\/help/i.test(text)) return send(chatId, HELP);
    if (/^\/checkin/i.test(text)) {
      const { text: t, rows } = checkinMessage();
      return send(chatId, t, rows);
    }
    if (/^\/watches/i.test(text)) {
      const ms = getDb().mandates.filter((m) => ["watching", "awaiting_approval"].includes(m.status));
      return send(chatId, ms.length ? ms.map((m) => `${m.productName}: ${m.status.replace("_", " ")}${m.lastNote ? ` (${m.lastNote})` : ""}`).join("\n") : "No open watches. Tell me something you want and your max price.");
    }
    const pondCmd = text.match(/^\/pond\s+(\d+(?:[.,]\d{1,2})?)/i);
    if (pondCmd) return pondFromPhone(chatId, Number(pondCmd[1].replace(",", ".")));
    if (!text) return;
    await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    const { reply } = await chat(text);
    return send(chatId, reply);
  });
}

async function pondFromPhone(chatId, amount) {
  const a = round2(amount);
  if (!(a >= 1 && a <= 500)) return send(chatId, "Pick an amount between €1 and €500, e.g. /pond 20");
  const pond = activePond();
  const payment = await startOrder({ kind: "pond", amount: a, description: `Goal ledger deposit to ${pond.name} (from Telegram)`, pondId: pond.id });
  const url = payUrl(payment);
  return send(chatId, `Pond ${eur(a)} into ${pond.name}: approve it in PayPal sandbox. I'll confirm here once PayPal captures it.`, url ? [[{ text: `Approve ${eur(a)} in PayPal`, url }]] : null);
}

async function onCallback(q) {
  const chatId = q.message?.chat?.id;
  const data = q.data || "";
  await tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  if (q.message?.chat?.type !== "private") return;
  const sid = chatId && sessionForTelegramChat(chatId);
  if (!sid || !isOwner(sid, q.from?.id)) return;
  await withSession(sid, async () => {
    const db = getDb();
    try {
      if (data === "noop") return send(chatId, "No problem. I'll check in later.");
      if (data === "noop:letgo") return send(chatId, "Let it go. Your goal keeps the win.");
      if (data.startsWith("watchitem:")) {
        const p = db.products.find((x) => x.id === data.slice(10));
        if (!p) return;
        const m = createMandate({ product_id: p.id, max_price: Math.floor(p.price * 0.85), cool_off_hours: 24 });
        return send(chatId, `Watching ${m.productName}: I'll only prepare it at €${m.maxPrice} or less, after a 24h cooling-off, and only if it fits your fun budget. You approve before anything is paid.`);
      }
      if (data.startsWith("release:")) {
        const m = db.mandates.find((x) => x.id === data.slice(8));
        if (!m) return;
        releaseMandate(m);
        return send(chatId, `Let go of ${m.productName}. Nothing spent. That's a win too.`);
      }
      if (data.startsWith("notnow:")) {
        const p = findPayment(data.slice(7));
        if (p) cancel(p);
        return send(chatId, "Okay, not now. I'm still watching, no pressure.");
      }
      if (data.startsWith("pond:")) return pondFromPhone(chatId, Number(data.slice(5)));
      if (data === "setup:confirm") {
        confirmSetup();
        return send(chatId, "Saved. I'll use these from now on.");
      }
      if (data === "setup:dismiss") {
        db.pendingSetup = null;
        save();
        return send(chatId, "Okay, nothing saved. Tell me what to change.");
      }
    } catch (e) {
      return send(chatId, e.message);
    }
  });
}

// ---------- Polling loop ----------
export async function startTelegram() {
  if (telegram.mode !== "live") return;
  try {
    const me = await tg("getMe");
    telegram.botUsername = me.username;
    await tg("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    console.log(`   Telegram: live (@${me.username})`);
  } catch (e) {
    telegram.mode = "error";
    console.error(`   Telegram: ${e.message}`);
    return;
  }
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35000);
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.message) await onMessage(u.message).catch((e) => console.error("telegram message:", e.message));
        if (u.callback_query) await onCallback(u.callback_query).catch((e) => console.error("telegram button:", e.message));
      }
    } catch (e) {
      if (!/aborted|timeout/i.test(e.message)) console.error("telegram poll:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

