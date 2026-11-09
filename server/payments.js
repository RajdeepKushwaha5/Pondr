// Payment lifecycle. App state changes only after PayPal confirms a capture,
// never on a browser redirect alone, and every apply is idempotent.
import { config } from "./config.js";
import * as paypal from "./paypal.js";
import { getDb, save, log, id, activePond, product, mandateEvent, notify } from "./store.js";
import { round2, mandateConditions } from "./money.js";

export const MERCHANT = "Pondr Demo Merchant (PayPal sandbox)";

const returnUrl = (pid) => `${config.baseUrl}/api/paypal/return?payment=${pid}`;
const cancelUrl = (pid) => `${config.baseUrl}/api/paypal/cancel?payment=${pid}`;

export async function startOrder({ kind, amount, description, productId, mandateId, pondId }) {
  const db = getDb();
  const payment = {
    id: id("pay"),
    kind,
    amount: round2(amount),
    description,
    productId,
    mandateId,
    pondId,
    status: "created",
    createdAt: new Date().toISOString(),
  };
  const order = await paypal.createOrder({
    amount: payment.amount,
    description,
    customId: payment.id,
    returnUrl: returnUrl(payment.id),
    cancelUrl: cancelUrl(payment.id),
    brandName: kind === "pond" ? "Pondr Goal Pond" : "Pondr Demo Store",
  });
  Object.assign(payment, { orderId: order.id, approveUrl: order.approveUrl, status: "awaiting_approval" });
  db.payments.unshift(payment);
  save();
  return payment;
}

export const findPayment = (pid) => getDb().payments.find((p) => p.id === pid);
export const findPaymentByOrder = (orderId) => getDb().payments.find((p) => p.orderId === orderId);

// Capture is only allowed for a payment still waiting for approval. For agent purchases the
// watch must still be active and still point at this exact payment; "Let it go" or "Not now"
// make an old approval link useless. The user's rules are re-checked before money moves.
export async function capture(payment) {
  // Already completed or in flight (e.g. the background approval check got there first).
  if (["completed", "capturing", "processing"].includes(payment.status)) return payment;
  if (payment.status !== "awaiting_approval") {
    payment.error = payment.error || `This payment is ${payment.status} and can't be completed.`;
    save();
    return payment;
  }
  const db = getDb();
  if (payment.kind === "mandate") {
    const m = db.mandates.find((x) => x.id === payment.mandateId);
    const item = product(payment.productId);
    let reason = null;
    if (!m || m.status !== "awaiting_approval" || m.paymentId !== payment.id) reason = "This watch was released or replaced, so this approval link is no longer valid.";
    else if (!item || item.price !== payment.amount) reason = "The price changed since this order was prepared.";
    else {
      const cond = mandateConditions(m, item.price, { excludePaymentId: payment.id });
      if (!cond.all) reason = cond.blockers[0] || "Your rules are no longer met.";
    }
    if (reason) {
      payment.status = "cancelled";
      payment.error = reason;
      if (m && m.status === "awaiting_approval" && m.paymentId === payment.id) Object.assign(m, { status: "watching", lastNote: `Approval stopped: ${reason}` });
      save();
      log("stop", `Didn't capture ${item?.name || "the order"}: ${reason}`);
      mandateEvent(m, "stopped", `Approval stopped before payment: ${reason}`);
      return payment;
    }
  }
  payment.status = "capturing"; // still reserves budget until a confirmed outcome
  mandateEvent(payment.mandateId, "approved", "You approved in PayPal. Rules re-checked; capturing the payment.");
  save();
  try {
    const result = await paypal.captureOrder(payment.orderId);
    if (result.status === "COMPLETED") return applyCompleted(payment, result.captureId);
    payment.status = result.status === "PENDING" ? "processing" : "failed";
    save();
    return payment;
  } catch (err) {
    // Only a definite PayPal rejection frees the reservation. Timeouts, 5xx and ambiguous
    // errors become "unknown" and are reconciled with PayPal in the background.
    payment.status = err.definite ? "failed" : "unknown";
    payment.error = err.message;
    if (payment.status === "failed") {
      releaseMandateAfterFailure(payment);
      mandateEvent(payment.mandateId, "failed", `PayPal declined the capture (${err.issue || "error"}).`);
    } else {
      payment.uncertainSince = new Date().toISOString();
      mandateEvent(payment.mandateId, "unknown", "No clear answer from PayPal. Budget stays held while Pondr checks.");
    }
    save();
    log("failed", `Payment ${payment.status === "failed" ? "failed" : "outcome unknown, checking with PayPal"}: ${payment.description}`);
    return payment;
  }
}

function releaseMandateAfterFailure(payment) {
  if (payment.kind !== "mandate") return;
  const m = getDb().mandates.find((x) => x.id === payment.mandateId);
  if (m && m.paymentId === payment.id && m.status === "awaiting_approval") Object.assign(m, { status: "watching", lastNote: "The PayPal payment didn't go through. Still watching." });
}

// Background recovery for payments without a final outcome. Reads PayPal's authoritative order
// state; if the buyer approved but no capture exists, retries the capture with the same
// PayPal-Request-Id (idempotent, so it can never charge twice). Unresolved for 30 minutes →
// "unresolved": still reserved and shown to the user, never silently released.
const UNRESOLVED_AFTER_MS = 30 * 60000;
export async function reconcile(payment) {
  if (!["processing", "unknown", "capturing", "unresolved"].includes(payment.status)) return payment;
  if (payment.status === "capturing" && Date.now() - new Date(payment.createdAt).getTime() < 120000) return payment;
  payment.reconcileAttempts = (payment.reconcileAttempts || 0) + 1;
  payment.uncertainSince ||= new Date().toISOString();
  try {
    const order = await paypal.getOrder(payment.orderId);
    const cap = order?.purchase_units?.[0]?.payments?.captures?.[0];
    const status = cap?.status || order?.status;
    if (status === "COMPLETED") return applyCompleted(payment, cap?.id || order?.captureId);
    if (["DECLINED", "FAILED", "VOIDED"].includes(status)) {
      payment.status = "failed";
      releaseMandateAfterFailure(payment);
      mandateEvent(payment.mandateId, "failed", `PayPal reports the order as ${status.toLowerCase()}.`);
      save();
      return payment;
    }
    if (status === "APPROVED" && payment.status !== "processing") {
      const result = await paypal.captureOrder(payment.orderId); // same idempotency key as the first try
      if (result.status === "COMPLETED") return applyCompleted(payment, result.captureId);
      if (result.status === "PENDING") payment.status = "processing";
    }
  } catch (err) {
    if (err.definite) {
      payment.status = "failed";
      payment.error = err.message;
      releaseMandateAfterFailure(payment);
      save();
      return payment;
    }
  }
  if (payment.status !== "processing" && Date.now() - new Date(payment.uncertainSince).getTime() > UNRESOLVED_AFTER_MS) {
    if (payment.status !== "unresolved") mandateEvent(payment.mandateId, "unknown", "Still unresolved with PayPal. Budget stays held; check the PayPal sandbox account.");
    payment.status = "unresolved";
  }
  save();
  return payment;
}

// Called from capture() and from a verified webhook; safe to call twice.
export function applyCompleted(payment, captureId) {
  if (payment.status === "completed") return payment;
  const db = getDb();
  payment.status = "completed";
  payment.captureId = captureId;
  payment.payee = MERCHANT;
  payment.completedAt = new Date().toISOString();

  if (payment.kind === "pond") {
    // The goal pond is an app ledger entry backed by this sandbox payment; it is not a PayPal balance.
    const pond = db.ponds.find((p) => p.id === payment.pondId) || activePond();
    pond.balance = round2(pond.balance + payment.amount);
    log("ponded", `Ponded €${payment.amount} into ${pond.name} instead of buying ${product(payment.productId)?.name || "it"}`);
    notify({ type: "ponded", amount: payment.amount, pond, captureId, item: product(payment.productId)?.name });
  } else if (payment.kind === "buy" || payment.kind === "mandate") {
    const item = product(payment.productId);
    db.transactions.unshift({
      id: id("t"),
      date: payment.completedAt,
      merchant: "Pondr Demo Store",
      category: item?.category || "other",
      amount: payment.amount,
      paypalCaptureId: captureId,
    });
    if (payment.kind === "mandate") {
      const m = db.mandates.find((x) => x.id === payment.mandateId);
      if (m) {
        m.status = "fulfilled";
        m.fulfilledAt = payment.completedAt;
        m.priceDrop = round2((m.originalPrice || payment.amount) - payment.amount);
        mandateEvent(m, "paid", `PayPal capture completed: €${payment.amount}.`, { captureId, orderId: payment.orderId });
      }
      log("bought", `You approved ${item?.name} for €${payment.amount}${m?.priceDrop ? ` (€${m.priceDrop} under your starting price)` : ""}`);
      notify({ type: "bought", amount: payment.amount, item: item?.name, captureId, priceDrop: m?.priceDrop });
    } else {
      log("bought", `Bought ${item?.name} for €${payment.amount}`);
    }
  }
  save();
  return payment;
}

export function cancel(payment) {
  if (payment.status !== "awaiting_approval") return payment; // can't cancel a capture already in flight
  payment.status = "cancelled";
  if (payment.kind === "mandate") {
    const m = getDb().mandates.find((x) => x.id === payment.mandateId);
    if (m && m.status === "awaiting_approval" && m.paymentId === payment.id) {
      Object.assign(m, { status: "watching", lastNote: "You said not now. Still watching, no pressure." });
      mandateEvent(m, "not_now", "You said not now. The order was cancelled; still watching.");
    }
  }
  save();
  return payment;
}

// ---------- Payouts: the pond only decreases once PayPal confirms delivery ----------
const PAYOUT_DONE = ["SUCCESS"];
const PAYOUT_FAILED = ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"];

// The payout intent (with a stable batch id) is saved and reserved BEFORE calling PayPal.
// A lost response leaves it "unknown"; re-sending the same batch id is idempotent.
export async function requestPayout(pond, receiver) {
  const db = getDb();
  if (pond.pendingWithdrawal > 0 || db.payments.some((p) => p.kind === "payout" && p.pondId === pond.id && ["submitting", "unknown", "pending"].includes(p.status))) {
    throw new Error("A payout from this pond is already in progress");
  }
  const amount = round2(pond.balance);
  if (!(amount > 0)) throw new Error("Nothing to pay out");
  const payment = { id: id("pay"), kind: "payout", amount, pondId: pond.id, receiver, senderBatchId: id("payout"), description: `Payout of ${pond.name}`, status: "submitting", createdAt: new Date().toISOString() };
  pond.pendingWithdrawal = amount;
  db.payments.unshift(payment);
  save();
  await submitPayout(payment, pond);
  if (payment.status === "pending") await refreshPayout(payment);
  return payment;
}

async function submitPayout(payment, pond) {
  try {
    const payout = await paypal.createPayout({ amount: payment.amount, receiver: payment.receiver, note: `Pondr: ${pond.name} goal payout`, batchId: payment.senderBatchId });
    Object.assign(payment, { status: "pending", payoutStatus: payout.status, payoutBatchId: payout.batchId, error: undefined });
    log("payout", `Payout of €${payment.amount} requested. Waiting for PayPal to confirm delivery.`);
  } catch (err) {
    if (err.definite || !err.paypal && err.definite !== false) {
      // Rejected outright (or our own pre-check failed): nothing was sent.
      payment.status = "failed";
      payment.error = err.message;
      pond.pendingWithdrawal = 0;
      log("failed", `Payout not sent: ${err.message}`);
    } else {
      payment.status = "unknown";
      payment.error = err.message;
      log("failed", `Payout outcome unknown. €${payment.amount} stays reserved while Pondr checks with PayPal.`);
    }
  }
  save();
}

export async function refreshPayout(payment) {
  if (payment.kind !== "payout") return payment;
  const pond = getDb().ponds.find((p) => p.id === payment.pondId);
  if (payment.status === "unknown" && pond) {
    await submitPayout(payment, pond); // idempotent re-send: returns the original batch if it exists
    if (payment.status !== "pending") return payment;
  }
  if (payment.status !== "pending") return payment;
  let status;
  try {
    status = await paypal.getPayoutStatus(payment.payoutBatchId);
  } catch (err) {
    payment.error = err.message;
    save();
    return payment;
  }
  payment.payoutStatus = status;
  if (PAYOUT_DONE.includes(status)) {
    payment.status = "completed";
    payment.completedAt = new Date().toISOString();
    if (pond) {
      pond.balance = round2(Math.max(0, pond.balance - payment.amount));
      pond.pendingWithdrawal = 0;
      pond.paidOutAt = payment.completedAt;
    }
    log("payout", `PayPal confirmed: €${payment.amount} from ${pond?.name || "your pond"} delivered.`);
    notify({ type: "payout", amount: payment.amount, pond });
  } else if (PAYOUT_FAILED.includes(status)) {
    payment.status = "failed";
    if (pond) pond.pendingWithdrawal = 0;
    log("failed", `Payout ${status.toLowerCase()}. €${payment.amount} is back in ${pond?.name || "your pond"}.`);
  }
  save();
  return payment;
}
