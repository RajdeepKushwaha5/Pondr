// PayPal REST client (sandbox). Falls back to a clearly labelled mock when no
// credentials are configured, so the full flow can be explored without keys.
import crypto from "node:crypto";
import { config, modes } from "./config.js";

const { apiBase, clientId, clientSecret } = config.paypal;
const money = (n) => Number(n).toFixed(2);

let token = { value: null, expires: 0 };
const TIMEOUT_MS = 20000;

// PayPal issues that mean "this will not succeed"; anything else (timeouts, 5xx, 429,
// ambiguous issues) is treated as an uncertain outcome and reconciled later.
const DEFINITE_ISSUES = new Set([
  "INSTRUMENT_DECLINED", "PAYER_ACTION_REQUIRED", "ORDER_NOT_APPROVED", "PAYER_CANNOT_PAY", "TRANSACTION_REFUSED",
  "ORDER_EXPIRED", "ORDER_VOIDED", "INVALID_RESOURCE_ID", "RESOURCE_NOT_FOUND", "PERMISSION_DENIED", "INSUFFICIENT_FUNDS",
  "RECEIVER_UNREGISTERED", "VALIDATION_ERROR", "INVALID_REQUEST",
]);

async function accessToken() {
  if (token.value && Date.now() < token.expires - 60000) return token.value;
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${data.error_description || res.status}`);
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

// Errors carry err.definite: true only when PayPal clearly says the operation can't succeed.
async function call(method, path, body, requestId) {
  const headers = { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" };
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  let res;
  try {
    res = await fetch(`${apiBase}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    const err = new Error(`PayPal ${method} ${path}: no response (${cause.name})`);
    err.definite = false;
    throw err;
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const issue = data.details?.[0]?.issue || data.name || String(res.status);
    const err = new Error(`PayPal ${method} ${path} failed: ${issue}`);
    err.paypal = data;
    err.issue = issue;
    err.status = res.status;
    err.definite = res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 429 && DEFINITE_ISSUES.has(issue);
    throw err;
  }
  return data;
}

const link = (data, rel) => data.links?.find((l) => l.rel === rel)?.href;

// ---------- Mock PayPal (no credentials) ----------
const mock = new Map();
const mockId = (p) => `MOCK-${p}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

// ---------- Orders v2 ----------
export async function createOrder({ amount, description, customId, returnUrl, cancelUrl, brandName = "Pondr" }) {
  if (modes.paypal === "mock") {
    const orderId = mockId("ORDER");
    mock.set(orderId, { status: "CREATED", amount: money(amount), description, customId, returnUrl, cancelUrl });
    return { id: orderId, status: "CREATED", approveUrl: `/mock-paypal.html?token=${orderId}` };
  }
  const data = await call(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        { reference_id: customId, custom_id: customId, description: description.slice(0, 127), amount: { currency_code: config.currency, value: money(amount) } },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: brandName,
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
    `create-${customId}`
  );
  return { id: data.id, status: data.status, approveUrl: link(data, "payer-action") || link(data, "approve") };
}

export async function captureOrder(orderId) {
  if (modes.paypal === "mock") {
    const o = mock.get(orderId);
    if (!o) throw new Error("Unknown mock order");
    if (o.status !== "APPROVED" && o.status !== "COMPLETED") throw new Error("Mock order not approved");
    o.status = "COMPLETED";
    o.captureId ||= mockId("CAPTURE");
    return { status: "COMPLETED", captureId: o.captureId, amount: o.amount };
  }
  const data = await call("POST", `/v2/checkout/orders/${orderId}/capture`, {}, `capture-${orderId}`);
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: capture?.status || data.status, captureId: capture?.id, amount: capture?.amount?.value };
}

export async function getOrder(orderId) {
  if (modes.paypal === "mock") return mock.get(orderId);
  return call("GET", `/v2/checkout/orders/${orderId}`);
}

// Mock-only: the simulated PayPal approval page calls this.
export function mockApprove(orderId) {
  const o = mock.get(orderId);
  if (!o) throw new Error("Unknown mock order");
  o.status = "APPROVED";
  return o;
}
export const mockOrder = (orderId) => mock.get(orderId);

// ---------- Subscriptions (payday auto-pond) ----------
export async function createSubscription({ amount, pondName, customId, returnUrl, cancelUrl }) {
  if (modes.paypal === "mock") {
    const subId = mockId("SUB");
    mock.set(subId, { status: "APPROVAL_PENDING", amount: money(amount), returnUrl, cancelUrl, kind: "subscription" });
    return { id: subId, approveUrl: `/mock-paypal.html?token=${subId}&kind=subscription` };
  }
  const product = await call("POST", "/v1/catalogs/products", { name: "Pondr auto-pond", type: "SERVICE", category: "SOFTWARE" }, `prod-${customId}`);
  const plan = await call(
    "POST",
    "/v1/billing/plans",
    {
      product_id: product.id,
      name: `Payday auto-pond: ${pondName}`,
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: money(amount), currency_code: config.currency } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
    },
    `plan-${customId}`
  );
  const sub = await call(
    "POST",
    "/v1/billing/subscriptions",
    {
      plan_id: plan.id,
      custom_id: customId,
      application_context: { brand_name: "Pondr", user_action: "SUBSCRIBE_NOW", shipping_preference: "NO_SHIPPING", return_url: returnUrl, cancel_url: cancelUrl },
    },
    `sub-${customId}`
  );
  return { id: sub.id, planId: plan.id, approveUrl: link(sub, "approve") };
}

export async function getSubscription(subId) {
  if (modes.paypal === "mock") {
    const s = mock.get(subId);
    if (s && s.status === "APPROVED") s.status = "ACTIVE";
    return s;
  }
  return call("GET", `/v1/billing/subscriptions/${subId}`);
}

// ---------- Payouts (goal reached / break the pond) ----------
export async function createPayout({ amount, receiver, note, batchId }) {
  // SAFETY LOCK (every mode): payouts only go to PayPal sandbox test accounts (…@*.example.com).
  if (!/@([a-z0-9-]+\.)*example\.com$/i.test(receiver)) {
    throw new Error("Payout receiver must be a PayPal sandbox test account (ends in example.com)");
  }
  if (modes.paypal === "mock") {
    return { batchId: `MOCK-PAYOUT-${batchId}`, status: "SUCCESS" };
  }
  // Same batchId + PayPal-Request-Id on retries: PayPal returns the original batch instead of paying twice.
  const data = await call(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: { sender_batch_id: batchId, email_subject: "Your Pondr goal payout" },
      items: [{ recipient_type: "EMAIL", amount: { value: money(amount), currency: config.currency }, receiver, note, sender_item_id: batchId }],
    },
    `payout-${batchId}`
  );
  return { batchId: data.batch_header?.payout_batch_id, status: data.batch_header?.batch_status };
}

// Item-level status is what matters for delivery (SUCCESS, UNCLAIMED, ONHOLD, FAILED, ...).
export async function getPayoutStatus(batchId) {
  if (modes.paypal === "mock") return "SUCCESS";
  const data = await call("GET", `/v1/payments/payouts/${batchId}`);
  return data.items?.[0]?.transaction_status || data.batch_header?.batch_status || "PENDING";
}

// ---------- Webhooks ----------
export async function verifyWebhook(headers, event) {
  if (modes.paypal === "mock" || !config.paypal.webhookId) return { verified: false, reason: "not configured" };
  const data = await call("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers["paypal-auth-algo"],
    cert_url: headers["paypal-cert-url"],
    transmission_id: headers["paypal-transmission-id"],
    transmission_sig: headers["paypal-transmission-sig"],
    transmission_time: headers["paypal-transmission-time"],
    webhook_id: config.paypal.webhookId,
    webhook_event: event,
  });
  return { verified: data.verification_status === "SUCCESS" };
}
