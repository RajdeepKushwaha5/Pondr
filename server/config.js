import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  // Render sets RENDER_EXTERNAL_URL automatically for hosted deploys.
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ""),
  currency: env.CURRENCY || "EUR",
  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || "",
    clientSecret: env.PAYPAL_CLIENT_SECRET || "",
    webhookId: env.PAYPAL_WEBHOOK_ID || "",
    payoutReceiver: env.PAYPAL_PAYOUT_RECEIVER || "",
    apiBase: "https://api-m.sandbox.paypal.com",
  },
  groq: {
    apiKey: env.GROQ_API_KEY || "",
    model: env.GROQ_MODEL || "openai/gpt-oss-120b",
    apiBase: "https://api.groq.com/openai/v1",
  },
  claude: {
    apiKey: env.ANTHROPIC_API_KEY || "",
    model: env.CLAUDE_MODEL || "claude-opus-5-5",
  },
  channel3: {
    apiKey: env.CHANNEL3_API_KEY || "",
    apiBase: "https://api.trychannel3.com/v1",
  },
};

// AI provider: explicit AI_PROVIDER wins, otherwise whichever key is present (Groq first).
const provider = (env.AI_PROVIDER || (config.groq.apiKey ? "groq" : config.claude.apiKey ? "claude" : "mock")).toLowerCase();

// SAFETY LOCK: Pondr only ever talks to PayPal's sandbox (test money). There is no
// setting to switch to live PayPal; this refuses to start if the address is changed.
const SANDBOX_HOST = "api-m.sandbox.paypal.com";
if (new URL(config.paypal.apiBase).host !== SANDBOX_HOST) {
  throw new Error(`Refusing to start: PayPal API must be ${SANDBOX_HOST} (sandbox only)`);
}
Object.freeze(config.paypal);

export const modes = {
  paypal: config.paypal.clientId && config.paypal.clientSecret ? "sandbox" : "mock",
  ai: provider,
  aiName: { groq: "Groq", claude: "Claude", mock: "Demo AI" }[provider] || provider,
  aiModel: provider === "groq" ? config.groq.model : provider === "claude" ? config.claude.model : null,
  channel3: config.channel3.apiKey ? "live" : "mock",
};
