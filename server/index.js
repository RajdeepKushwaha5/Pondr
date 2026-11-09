import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, modes } from "./config.js";
import * as paypal from "./paypal.js";
import { getDb, save, log, reset, id, activePond, product, withSession, sessionIds, newSessionId, validSessionId, sessionForOrder, sessionForSubscription, sessionForPayment } from "./store.js";
import { startOrder, capture, cancel, findPayment, findPaymentByOrder, applyCompleted, requestPayout, refreshPayout, reconcile, MERCHANT } from "./payments.js";
import { duckDecision, chat, createMandate, releaseMandate, watchTick, confirmSetup } from "./agent.js";
import { startTelegram, telegram as telegramInfo, telegramStatus, createLinkCode, unlinkTelegram, sendCheckin, setCheckins, runDueCheckins } from "./telegram.js";
import { daysOfSaving, spendLast30, recurringCharges, budgetSnapshot, mandateConditions, pondFor, goalMoney, round2 } from "./money.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(here, "..", "public")));

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((err) => {
      console.error(err);
      res.status(400).json({ error: err.message });
    });

// Health check for the host (no session is created).
const telegramStatusMode = () => telegramInfo.mode;
app.get("/healthz", (req, res) => res.json({ ok: true, paypal: modes.paypal, ai: modes.ai, channel3: modes.channel3, telegram: telegramStatusMode() }));

// ---- PayPal webhooks: no visitor cookie; strictly verified in sandbox mode ----
// Mounted before the session middleware so it never creates demo sessions.
app.post(
  "/api/paypal/webhook",
  wrap(async (req, res) => {
    const event = req.body || {};
    if (modes.paypal === "sandbox") {
      if (!config.paypal.webhookId) return res.status(503).json({ error: "Webhooks disabled: PAYPAL_WEBHOOK_ID not configured" });
      const { verified } = await paypal.verifyWebhook(req.headers, event);
      if (!verified) return res.status(400).json({ error: "signature verification failed" });
    }
    const r = event.resource || {};
    let sid = null;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") sid = sessionForOrder(r.supplementary_data?.related_ids?.order_id);
    else if (event.event_type?.startsWith("BILLING.SUBSCRIPTION") || event.event_type === "PAYMENT.SALE.COMPLETED") sid = sessionForSubscription(r.billing_agreement_id || r.id);
    if (!sid) return res.json({ ok: true, ignored: true });

    await withSession(sid, async () => {
      const db = getDb();
      if (db.processedEvents.includes(event.id)) return;
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const payment = findPaymentByOrder(r.supplementary_data.related_ids.order_id);
        // Agent purchases are only captured by our server after a rules re-check; the webhook just confirms.
        if (payment && payment.status !== "awaiting_approval") applyCompleted(payment, r.id);
      } else if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") {
        db.subscription.status = "ACTIVE";
      } else if (event.event_type === "PAYMENT.SALE.COMPLETED") {
        const pond = db.ponds.find((p) => p.id === db.subscription.pondId) || activePond();
        const amount = round2(Number(r.amount?.total || db.subscription.amount));
        if (!db.payments.some((p) => p.captureId === r.id)) {
          pond.balance = round2(pond.balance + amount);
          db.payments.unshift({ id: id("pay"), kind: "pond", source: "subscription", amount, pondId: pond.id, status: "completed", captureId: r.id, description: `Monthly auto-pond to ${pond.name}`, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() });
          log("payday", `Monthly auto-pond collected by PayPal: €${amount} into ${pond.name}`);
        }
      }
      db.processedEvents = [event.id, ...db.processedEvents].slice(0, 500);
      save();
    });
    res.json({ ok: true });
  })
);

// ---- Per-visitor demo session ----
const COOKIE = "pondr_sid";
const sessionCookie = (sid) =>
  `${COOKIE}=${sid}; Path=/; HttpOnly; Max-Age=1209600; SameSite=${config.baseUrl.startsWith("https://") ? "None; Secure" : "Lax"}`;
app.use((req, res, next) => {
  const match = (req.headers.cookie || "").match(/(?:^|;\s*)pondr_sid=([a-f0-9]{24})/);
  let sid = match?.[1];
  if (!validSessionId(sid)) {
    sid = newSessionId();
    res.setHeader("Set-Cookie", sessionCookie(sid));
  }
  withSession(sid, () => next());
});

function insights() {
  const db = getDb();
  const byCategory = {};
  for (const t of db.transactions) {
    if (Date.now() - new Date(t.date).getTime() > 30 * 86400000) continue;
    byCategory[t.category] = round2((byCategory[t.category] || 0) + t.amount);
  }
  return { spentLast30: spendLast30(), byCategory, recurring: recurringCharges(), demoData: db.transactions.some((t) => t.demo) };
}

app.get(
  "/api/state",
  wrap((req, res) => {
    const db = getDb();
    res.json({
      modes,
      currency: config.currency,
      merchant: MERCHANT,
      user: db.user,
      budget: budgetSnapshot(),
      ponds: db.ponds.map((p) => ({ ...p, money: goalMoney(p) })),
      activePond: { ...activePond(), money: goalMoney(activePond()) },
      products: db.products,
      mandates: db.mandates,
      payments: db.payments.slice(0, 15),
      activity: db.activity.slice(0, 25),
      chat: db.chat.slice(-20),
      subscription: db.subscription,
      pendingSetup: db.pendingSetup || null,
      telegram: telegramStatus(),
      insights: insights(),
    });
  })
);

// External carts (browser extension) must state their currency; this prototype only handles EUR,
// so 89 RON is never treated as €89.
function assertCurrency(currency) {
  if (currency !== config.currency) {
    const err = new Error(`This cart looks like it's in ${currency || "an unknown currency"}. Pondr's prototype only supports ${config.currency} carts.`);
    throw err;
  }
}

// ---- Checkout duck ----
app.post(
  "/api/duck",
  wrap(async (req, res) => {
    const { productId, amount, title, currency } = req.body;
    if (!productId) assertCurrency(currency);
    const item = productId ? product(productId) : { id: null, name: title || "this item", category: "other", price: round2(Number(amount)) };
    if (!item || !(item.price > 0)) throw new Error("Unknown product or amount");
    res.json({ item, merchant: MERCHANT, ...(await duckDecision(item, item.price)) });
  })
);

app.post(
  "/api/checkout",
  wrap(async (req, res) => {
    const { productId, choice, amount, title, currency } = req.body;
    if (!productId) assertCurrency(currency);
    const item = productId ? product(productId) : null;
    const value = item ? item.price : round2(Number(amount));
    if (!(value > 0)) throw new Error("Invalid amount");
    const pond = activePond();
    let payment;
    if (choice === "pond") {
      payment = await startOrder({
        kind: "pond",
        amount: value,
        description: `Goal ledger deposit to ${pond.name} instead of ${item?.name || title || "an impulse buy"}`,
        productId: item?.id,
        pondId: pond.id,
      });
    } else if (choice === "buy" && item) {
      payment = await startOrder({ kind: "buy", amount: value, description: `Pondr Demo Store: ${item.name}`, productId: item.id });
    } else {
      throw new Error("choice must be 'buy' (store items) or 'pond'");
    }
    res.json({ paymentId: payment.id, approveUrl: payment.approveUrl });
  })
);

// ---- PayPal redirects ----
const afterUrl = (p) => (p.kind === "mandate" ? `/approve.html?payment=${p.id}` : p.kind === "pond" && !p.productId ? `/app.html?done=${p.id}` : `/store.html?done=${p.id}`);

// Run a PayPal redirect inside the session that owns the payment, and restore that
// visitor's cookie (browsers may drop it on the cross-site hop back from PayPal).
async function inOwnerSession(req, res, fn) {
  const sid = sessionForPayment(String(req.query.payment || ""));
  if (!sid) throw new Error("Unknown payment");
  res.setHeader("Set-Cookie", sessionCookie(sid));
  return withSession(sid, () => fn(findPayment(req.query.payment)));
}

app.get(
  "/api/paypal/return",
  wrap((req, res) =>
    inOwnerSession(req, res, async (payment) => {
      if (req.query.token && req.query.token !== payment.orderId) throw new Error("Order mismatch");
      await capture(payment); // server-side capture after rule checks; state changes only on COMPLETED
      res.redirect(afterUrl(payment));
    })
  )
);

app.get(
  "/api/paypal/cancel",
  wrap((req, res) =>
    inOwnerSession(req, res, (payment) => {
      cancel(payment);
      res.redirect(afterUrl(payment));
    })
  )
);

app.get(
  "/api/payments/:id",
  wrap((req, res) => {
    const payment = findPayment(req.params.id);
    if (!payment) throw new Error("Unknown payment");
    const mandate = getDb().mandates.find((m) => m.id === payment.mandateId);
    const item = product(payment.productId);
    // Live rule check for the approval screen (the same check capture() runs).
    let live = null;
    if (mandate && item) {
      const c = mandateConditions(mandate, item.price, { excludePaymentId: payment.id });
      const linkValid = mandate.status === "awaiting_approval" && mandate.paymentId === payment.id;
      const priceSame = item.price === payment.amount;
      live = {
        ok: c.all && linkValid && priceSame,
        priceNow: item.price,
        priceOk: c.priceOk,
        coolOffOk: c.coolOffOk,
        budgetOk: c.budgetOk,
        pondOk: c.pondOk,
        linkValid,
        priceSame,
        budget: c.budget,
        pond: (({ name, balance, target }) => ({ name, balance, target }))(pondFor(mandate)),
        blockers: [...(!linkValid ? ["This watch was released or replaced."] : []), ...(!priceSame ? [`The price changed to €${item.price} since this order was prepared.`] : []), ...c.blockers],
      };
    }
    res.json({ payment, mandate, product: item, pond: activePond(), live, budget: budgetSnapshot({ excludePaymentId: payment.id }), merchant: MERCHANT, modes });
  })
);

// ---- Mock PayPal approval (only when no sandbox credentials) ----
app.get(
  "/api/mock-paypal/:token",
  wrap((req, res) => {
    if (modes.paypal !== "mock") throw new Error("Mock PayPal disabled");
    const o = paypal.mockOrder(req.params.token);
    if (!o) throw new Error("Unknown mock token");
    res.json(o);
  })
);
app.post(
  "/api/mock-paypal/:token/approve",
  wrap((req, res) => {
    if (modes.paypal !== "mock") throw new Error("Mock PayPal disabled");
    const o = paypal.mockApprove(req.params.token);
    const sep = o.returnUrl.includes("?") ? "&" : "?";
    res.json({ redirect: `${o.returnUrl}${sep}token=${req.params.token}` });
  })
);

// ---- Wait & Watch ----
const mandateById = (mid) => {
  const m = getDb().mandates.find((x) => x.id === mid);
  if (!m) throw new Error("Unknown watch");
  return m;
};
app.post(
  "/api/mandates",
  wrap((req, res) => res.json(createMandate(req.body)))
);
app.post(
  "/api/mandates/:id/cancel",
  wrap((req, res) => {
    const m = mandateById(req.params.id);
    m.status = "cancelled";
    save();
    log("stop", `Stopped watching ${m.productName}`);
    res.json(m);
  })
);
app.post(
  "/api/mandates/:id/release",
  wrap((req, res) => res.json(releaseMandate(mandateById(req.params.id))))
);

// ---- Chat ----
app.post(
  "/api/chat",
  wrap(async (req, res) => {
    const text = String(req.body.text || "").slice(0, 1000).trim();
    if (!text) throw new Error("Empty message");
    res.json(await chat(text));
  })
);

// ---- Onboarding: the AI proposes, the user confirms ----
app.post(
  "/api/setup/confirm",
  wrap((req, res) => res.json(confirmSetup()))
);
app.post(
  "/api/setup/dismiss",
  wrap((req, res) => {
    getDb().pendingSetup = null;
    save();
    res.json({ ok: true });
  })
);

// ---- Telegram companion ----
app.get("/api/telegram", wrap((req, res) => res.json(telegramStatus())));
app.post("/api/telegram/link", wrap((req, res) => res.json(createLinkCode())));
app.post(
  "/api/telegram/unlink",
  wrap((req, res) => {
    unlinkTelegram();
    res.json({ ok: true });
  })
);
app.post(
  "/api/telegram/schedule",
  wrap((req, res) => res.json(setCheckins(String(req.body.every || "off"))))
);
app.post(
  "/api/telegram/checkin",
  wrap(async (req, res) => {
    await sendCheckin();
    res.json({ ok: true });
  })
);

// ---- Settings ----
app.post(
  "/api/budget",
  wrap((req, res) => {
    const v = round2(Number(req.body.monthlyFunBudget));
    if (!(v >= 0 && v <= 10000)) throw new Error("Budget must be between 0 and 10000");
    getDb().user.monthlyFunBudget = v;
    save();
    log("pond", `Fun budget set to €${v} per month`);
    res.json(budgetSnapshot());
  })
);

// ---- Ponds, monthly auto-pond subscription, payouts ----
app.post(
  "/api/ponds",
  wrap((req, res) => {
    const { name, target } = req.body;
    if (!name || !(Number(target) > 0)) throw new Error("name and target required");
    const pond = { id: id("pond"), name: String(name).slice(0, 40), target: round2(Number(target)), balance: 0, pendingWithdrawal: 0, createdAt: new Date().toISOString() };
    const db = getDb();
    db.ponds.push(pond);
    db.activePondId = pond.id;
    save();
    log("pond", `New pond: ${pond.name} (€${pond.target})`);
    res.json(pond);
  })
);

app.post(
  "/api/ponds/:id/activate",
  wrap((req, res) => {
    const db = getDb();
    if (!db.ponds.some((p) => p.id === req.params.id)) throw new Error("Unknown pond");
    db.activePondId = req.params.id;
    save();
    res.json({ ok: true });
  })
);

app.post(
  "/api/autopond",
  wrap(async (req, res) => {
    const amount = round2(Number(req.body.amount));
    if (!(amount >= 1 && amount <= 1000)) throw new Error("Amount must be between 1 and 1000");
    const pond = activePond();
    const sub = await paypal.createSubscription({
      amount,
      pondName: pond.name,
      customId: id("autopond"),
      returnUrl: `${config.baseUrl}/api/autopond/return`,
      cancelUrl: `${config.baseUrl}/app.html?autopond=cancelled`,
    });
    getDb().subscription = { id: sub.id, amount, pondId: pond.id, status: "APPROVAL_PENDING", createdAt: new Date().toISOString() };
    save();
    res.json({ approveUrl: sub.approveUrl });
  })
);

app.get(
  "/api/autopond/return",
  wrap(async (req, res) => {
    const db = getDb();
    if (!db.subscription) throw new Error("No subscription pending");
    const sub = await paypal.getSubscription(db.subscription.id);
    db.subscription.status = sub?.status || "UNKNOWN";
    save();
    if (["ACTIVE", "APPROVED"].includes(db.subscription.status)) log("autopond", `Monthly auto-pond set up: €${db.subscription.amount}/month via PayPal Subscriptions`);
    res.redirect("/app.html?autopond=done");
  })
);

app.post(
  "/api/ponds/:id/payout",
  wrap(async (req, res) => {
    const pond = getDb().ponds.find((p) => p.id === req.params.id);
    if (!pond) throw new Error("Unknown pond");
    const payment = await requestPayout(pond, config.paypal.payoutReceiver || "sandbox-buyer@example.com");
    res.json(payment);
  })
);

// ---- Demo controls (only affect this visitor's demo) ----
app.post(
  "/api/demo/price",
  wrap(async (req, res) => {
    const item = product(req.body.productId);
    if (!item) throw new Error("Unknown product");
    const price = round2(Number(req.body.price));
    if (!(price > 0) || price > item.listPrice * 2) throw new Error("Invalid price");
    item.price = price;
    save();
    log("price", `Simulated store price change: ${item.name} is now €${price}`);
    await watchTick();
    res.json({ item, mandates: getDb().mandates.filter((m) => m.productId === item.id) });
  })
);

// Simulates a day passing: cooling-off periods and deadlines move 24h closer.
app.post(
  "/api/demo/skip-day",
  wrap(async (req, res) => {
    const db = getDb();
    const shift = (iso) => (iso ? new Date(new Date(iso).getTime() - 86400000).toISOString() : iso);
    for (const m of db.mandates.filter((x) => ["watching", "awaiting_approval"].includes(x.status))) {
      m.coolOffUntil = shift(m.coolOffUntil);
      m.deadline = shift(m.deadline);
    }
    if (db.telegram?.checkins?.nextAt) db.telegram.checkins.nextAt = shift(db.telegram.checkins.nextAt);
    save();
    log("clock", "Simulated: one day passed");
    await watchTick();
    await runDueCheckins();
    res.json({ mandates: db.mandates });
  })
);

// Guided scenarios for judges: each resets this visitor's demo and sets up one decision.
app.post(
  "/api/demo/scenario/:name",
  wrap(async (req, res) => {
    const setPrice = async (pid, price) => {
      product(pid).price = price;
      save();
      log("price", `Simulated store price change: ${product(pid).name} is now €${price}`);
      await watchTick();
    };
    const prepared = (pid) => getDb().mandates.find((m) => m.productId === pid && m.status === "awaiting_approval");
    reset();
    switch (req.params.name) {
      case "ready": {
        createMandate({ product_id: "p_headphones", max_price: 75, cool_off_hours: 0 });
        await setPrice("p_headphones", 72);
        const m = prepared("p_headphones");
        return res.json({ redirect: m ? `/approve.html?payment=${m.paymentId}` : "/app.html", message: "Ready to buy: every rule passes, so Pondr prepared a PayPal order." });
      }
      case "budget": {
        createMandate({ product_id: "p_sneakers", max_price: 100, cool_off_hours: 0 });
        await setPrice("p_sneakers", 95);
        return res.json({ redirect: "/app.html#watches", message: "Budget says wait: the price is right, but €95 doesn't fit the €82 fun budget." });
      }
      case "changed-mind": {
        createMandate({ product_id: "p_lamp", max_price: 40, cool_off_hours: 0 });
        await setPrice("p_lamp", 38);
        const m = prepared("p_lamp");
        return res.json({ redirect: m ? `/approve.html?payment=${m.paymentId}&hint=letgo` : "/app.html", message: "Changed my mind: the order is ready, but you can let it go." });
      }
      default:
        throw new Error("Unknown scenario");
    }
  })
);

app.post(
  "/api/demo/payday",
  wrap((req, res) => {
    const db = getDb();
    if (!db.subscription || !["ACTIVE", "APPROVED"].includes(db.subscription.status)) throw new Error("Set up auto-pond first");
    const pond = activePond();
    // Simulated cycle: counts toward progress only (no PayPal capture, so not withdrawable).
    pond.balance = round2(pond.balance + db.subscription.amount);
    pond.simulated = round2((pond.simulated || 0) + db.subscription.amount);
    save();
    log("payday", `Simulated monthly cycle: €${db.subscription.amount} added to ${pond.name} progress (not a real PayPal collection)`);
    res.json(pond);
  })
);

app.post(
  "/api/demo/fresh",
  wrap((req, res) => {
    reset({ fresh: true });
    res.json({ ok: true });
  })
);

app.post(
  "/api/demo/reset",
  wrap((req, res) => {
    reset();
    res.json({ ok: true });
  })
);

app.get("/api/days", (req, res) => res.json({ days: daysOfSaving(Number(req.query.amount)) }));

// Background: evaluate watches and refresh pending payouts for every active demo session.
setInterval(async () => {
  for (const sid of sessionIds()) {
    await withSession(sid, async () => {
      try {
        await watchTick();
        await runDueCheckins();
        for (const p of getDb().payments.filter((x) => x.kind === "payout" && ["pending", "unknown"].includes(x.status))) await refreshPayout(p);
        for (const p of getDb().payments.filter((x) => x.kind !== "payout" && ["processing", "unknown", "capturing", "unresolved"].includes(x.status))) await reconcile(p);
        // Approved in PayPal but the return page never loaded (e.g. approved on a phone): capture now.
        for (const p of getDb().payments.filter((x) => x.status === "awaiting_approval" && x.orderId && Date.now() - new Date(x.createdAt).getTime() > 15000)) {
          const order = await paypal.getOrder(p.orderId).catch(() => null);
          if (order?.status === "APPROVED") await capture(p);
        }
      } catch (e) {
        console.error("background:", e.message);
      }
    });
  }
}, 15000);

startTelegram().catch((e) => console.error("telegram:", e.message));

app.listen(config.port, () => {
  console.log(`Pondr running at ${config.baseUrl}`);
  console.log(`   PayPal: ${modes.paypal} · AI: ${modes.aiName}${modes.aiModel ? ` (${modes.aiModel})` : ""} · Channel3: ${modes.channel3}`);
});
