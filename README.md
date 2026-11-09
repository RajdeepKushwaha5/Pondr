# 🦆 Pondr: think before you pay

**Turn a checkout impulse into a deliberate step toward your goal.**

Pondr is a companion that knows what you are saving for. At checkout it shows what a purchase means for that goal, and lets you choose: put the amount toward your goal instead (you still press pay), buy it anyway, or wait for a planned purchase that fits your rules. It remembers what you chose, follows up on your phone, and never pays without your approval.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) with **PayPal (sandbox)** and an **LLM agent** (Groq gpt-oss-120b by default, Claude optional), plus **Channel3** product data.

**Primary:** make a deliberate decision that respects your goal.
**Secondary:** contribute to the goal, buy now, or wait for a planned purchase (Wait & Watch).

---

## What it does

When you're about to pay, Pondr's duck steps in with your real numbers. For example: *"€89 = 9 days of your Apartment fund."* Then it gives you three choices:

| Choice | What happens | PayPal |
|---|---|---|
| **Pond it** | You still press pay; the amount is recorded in your goal ledger. The sandbox payee (demo merchant) is shown on screen. | Orders v2 (create → approve → capture); the ledger updates only after capture |
| **Wait & Watch** | You set rules: max total price, cooling-off hours (default 24), deadline, optional goal %. Every purchase must also fit your declared **fun budget**. The agent compares market prices (Channel3, comparison only) and explains what it's waiting for. When all rules hold, it prepares an order from the integrated demo merchant and asks "Still want it?" You can approve, say not now, or let it go. | Agent-prepared Orders v2; **rules re-checked before capture**; the agent can never capture on its own |
| **Buy now** | A normal PayPal checkout, without guilt. | Orders v2 |

**Fun budget** = your declared monthly budget for wants − discretionary spending in the last 30 days − agent orders awaiting approval. Groceries, rent and subscriptions don't count.

It also:

- **Knows when to stay quiet.** It doesn't step in on groceries, rent or other essentials.
- **Monthly auto-pond:** saves before you spend, using **PayPal Subscriptions** (a monthly schedule; it does not detect paydays).
- **Goal reached:** requests a **PayPal Payout**. The pond stays reserved as "pending" and only drops once PayPal reports the payout item as SUCCESS; failures restore it.
- **Chat buddy:** an AI agent with tools that reads your spending, finds recurring charges and creates watches from plain language ("I want the headphones but cheaper, max 75").
- **Chrome extension (prototype):** the same duck on checkout pages where it can read an EUR total; tested mainly on the demo store.
- **Telegram companion:** link your phone with a one-time code; Pondr messages you when something happens, sends opt-in scheduled check-ins, and lets you approve, let go, or pond from your phone.
- **Onboarding chat:** tell Pondr your goal, what you have saved and what you can put aside; it proposes settings you confirm. Every number shows its source ("you told Pondr", demo history, PayPal sandbox).

## How the AI works (and how it's kept safe)

- **Code does the maths.** Days of saving, affordability and the mandate rules are all computed deterministically ([server/money.js](server/money.js)). The AI only gets these facts and is told never to invent numbers.
- **The AI decides and writes.** It decides whether an intervention is worth showing (JSON output) and writes the duck's message. The headline numbers are always built in code. It runs the chat agent and the Wait & Watch agent using tool use ([server/agent.js](server/agent.js)).
- **Guardrails live on the server.** The agent's only money-related tool, `prepare_purchase`, re-checks the user's rule on the server, can only create an order at the current store price, and can never capture. Payment requires the user's PayPal approval.
- **State changes only after PayPal confirms.** Server-side capture and verified webhooks are both idempotent ([server/payments.js](server/payments.js)). A browser redirect alone never marks money as moved.
- **Models:** provider-neutral layer ([server/llm.js](server/llm.js)). Groq `openai/gpt-oss-120b` via its OpenAI-compatible API when `GROQ_API_KEY` is set, or Claude `claude-opus-5-5` when `ANTHROPIC_API_KEY` is set. Any AI error falls back to deterministic templates, so the demo never breaks.

## PayPal capabilities used

| Capability | Where |
|---|---|
| OAuth 2.0 client credentials | `server/paypal.js`: `accessToken()` |
| **Orders v2**: create (with `experience_context` return/cancel URLs), capture, idempotent `PayPal-Request-Id` | Pond it, Buy now, agent purchases |
| **Webhooks**, strictly signature-verified in sandbox mode (`/v1/notifications/verify-webhook-signature`); disabled if `PAYPAL_WEBHOOK_ID` is unset | `POST /api/paypal/webhook`: `PAYMENT.CAPTURE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED`, `PAYMENT.SALE.COMPLETED` |
| **Subscriptions**: catalog product → billing plan → subscription | Payday auto-pond |
| **Payouts** + status polling (`GET /v1/payments/payouts/{id}`) | Goal payout |

## Quick start

```bash
npm install
cp .env.example .env      # optional: runs fully in mock mode without keys
npm start                 # http://localhost:3000 (set PORT in .env to change)
```

Open the landing page, click **Try it as Ana**, then **Open the demo store** → **Pay with PayPal** on the headphones.

Badges in the header show each integration's mode. **mock** means no keys are configured; every mock is clearly labelled and moves no money.

### Real PayPal sandbox

1. Create a sandbox REST app at <https://developer.paypal.com/dashboard/applications/sandbox>. Put `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env`.
2. Set `BASE_URL` to the URL PayPal should redirect back to (for example your Render URL).
3. Optional: add a webhook in the app pointing to `BASE_URL/api/paypal/webhook` and set `PAYPAL_WEBHOOK_ID`.
4. Set `PAYPAL_PAYOUT_RECEIVER` to your **sandbox personal** account email, so payouts land there.
5. Pay with a sandbox **personal** account (Developer Dashboard → Testing Tools → Sandbox Accounts).

### AI and Channel3

- `GROQ_API_KEY`: free key from <https://console.groq.com/keys> (default provider). Optional `GROQ_MODEL`.

- `ANTHROPIC_API_KEY`: optional alternative, from <https://console.anthropic.com>. Force a provider with `AI_PROVIDER=groq|claude|mock`.
- `CHANNEL3_API_KEY`: from <https://trychannel3.com/developers>. Promo code `PAYPAL-HACKATHON-2026`.

## For judges: the 2-minute test

**Fastest path:** open **My ponds → Demo controls** and click one of the three guided scenarios: **Ready to buy** (every rule passes; see the decision receipt and approve in PayPal sandbox), **Budget says wait** (the agent explains why it waits) and **Changed my mind** (let it go; nothing is spent). Every watch has a timeline of each step, and every receipt is computed by the rules engine, not the AI.

Or step by step:

1. Open the hosted demo (link on the Devpost page) and click **Try it as Ana**. No signup: you're **Ana**, saving for an apartment.
2. **Demo Store** → headphones → **Pay with PayPal** → the duck appears → **Pond it** → approve with the sandbox buyer account in the Devpost testing instructions → the pond fills.
3. Store → headphones → **Wait & Watch** at €75 (24h cooling-off).
4. Dashboard → **Demo controls** → set the headphones to €72. The agent explains it's in cooling-off. Click **Skip ahead a day**: it checks the fun budget and market, then prepares a PayPal order → **Review & approve** → "Still want it?"
5. Watch the sneakers at €100 with 0h cooling-off, set them to €95: the agent waits because the fun budget doesn't cover it.
6. Any watch → **Let it go**.
7. Add the **Weekly Groceries Box** to see Pondr deliberately *not* step in.
8. **Reset my demo** at any time. Every visitor has an isolated demo session (cookie), so judges don't interfere with each other.

## Deploy to Render

1. Render dashboard → **New → Blueprint** → select this repository (it uses [render.yaml](render.yaml)).
2. Enter the secret values when prompted: `GROQ_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PAYOUT_RECEIVER` (a sandbox `…@personal.example.com` account), `CHANNEL3_API_KEY`. `BASE_URL` is picked up automatically from Render.
3. Optional: in the PayPal app, add a webhook to `https://<your-app>.onrender.com/api/paypal/webhook` for `PAYMENT.CAPTURE.COMPLETED`, `BILLING.SUBSCRIPTION.ACTIVATED` and `PAYMENT.SALE.COMPLETED`, then set `PAYPAL_WEBHOOK_ID` in Render.

Notes: the free plan sleeps after inactivity (first load takes ~1 minute) and its disk is temporary, so demo sessions reset on redeploy. The hackathon's Render credits can pay for an always-on instance during judging (until Dec 15).

**Safety:** Pondr can only reach PayPal's sandbox (`api-m.sandbox.paypal.com`); it refuses to start otherwise, and payouts only go to `example.com` sandbox accounts. No real money can move.

## Chrome extension

`chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`. Set the server URL in the extension popup.

On checkout pages, the first click on "Pay / Place order" shows the duck. Clicking again continues as normal.

## Project structure

```
server/   Express API: PayPal client, AI agent (Groq/Claude), Channel3, payment lifecycle, JSON store
public/   Landing page (index.html), dashboard (app.html), demo store, duck overlay, approval page, mock-PayPal page
extension/ Chrome MV3 extension
```

## Limitations (honest)

- **Sandbox only.** No real money moves. Ponds are an app ledger backed by sandbox payments to the demo merchant, not a bank or PayPal balance. A production version needs a regulated partner to hold goal money.
- **Pondr only buys from the integrated demo merchant.** Channel3 results are market comparisons; buying from other retailers would need a merchant/platform arrangement.
- The fun budget is user-declared, not inferred from bank data. "Fits your rules" is not a claim that the user can afford something.
- Not built: PayPal Transaction Search insights, PayPal Agent Toolkit/MCP, WhatsApp.
- Insights use seeded demo history for "Ana" plus real purchases made in the demo store.
- The demo store's price changes are simulated so judges can see the agent act without waiting days.
- One JSON file per demo session under `data/sessions/` (hackathon scope).

## License

[MIT](LICENSE)
