// Provider-neutral LLM layer: Groq (OpenAI-compatible REST) or Claude (Anthropic SDK).
// Tools are defined once in Anthropic shape ({ name, description, input_schema }) and
// translated per provider. Callers fall back to deterministic templates on any error.
import Anthropic from "@anthropic-ai/sdk";
import { config, modes } from "./config.js";

export class AIUnavailable extends Error {}

// ---------------- Groq ----------------
async function groqChat({ messages, tools, json, maxTokens = 1500 }) {
  const body = { model: config.groq.model, messages, max_tokens: maxTokens, temperature: 0.3 };
  if (tools?.length) {
    body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    body.tool_choice = "auto";
  }
  if (json) body.response_format = { type: "json_object" };
  const res = await fetch(`${config.groq.apiBase}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.groq.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000), // a hung AI call must not stall the background loop
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Groq ${res.status}: ${data.error?.message || res.statusText}`);
  return data.choices[0].message;
}

const groq = {
  async askJSON({ system, messages, schema, maxTokens }) {
    const msg = await groqChat({
      messages: [
        { role: "system", content: `${system}\n\nRespond with only a JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` },
        ...messages,
      ],
      json: true,
      maxTokens,
    });
    return JSON.parse(msg.content);
  },

  async runAgent({ system, messages, tools, runTool, maxTurns = 8 }) {
    const convo = [{ role: "system", content: system }, ...messages];
    const trace = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const msg = await groqChat({ messages: convo, tools });
      convo.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
      if (!msg.tool_calls?.length) return { text: (msg.content || "").trim(), trace };
      for (const call of msg.tool_calls) {
        let content;
        try {
          const input = JSON.parse(call.function.arguments || "{}");
          const output = await runTool(call.function.name, input);
          trace.push({ tool: call.function.name, input, output });
          content = JSON.stringify(output);
        } catch (err) {
          trace.push({ tool: call.function.name, error: err.message });
          content = `Error: ${err.message}`;
        }
        convo.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    return { text: "I ran out of steps on that one. Could you try rephrasing?", trace };
  },
};

// ---------------- Claude ----------------
const anthropic = modes.ai === "claude" ? new Anthropic({ apiKey: config.claude.apiKey, timeout: 60000, maxRetries: 1 }) : null;

async function claudeAsk({ system, messages, tools, effort = "low", schema, maxTokens = 16000 }) {
  const output_config = { effort };
  if (schema) output_config.format = { type: "json_schema", schema };
  const response = await anthropic.beta.messages.create({
    model: config.claude.model,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config,
    system,
    messages,
    ...(tools ? { tools } : {}),
  });
  if (response.stop_reason === "refusal") throw new AIUnavailable("Request declined");
  return response;
}
const claudeText = (r) => r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

const claude = {
  async askJSON(opts) {
    return JSON.parse(claudeText(await claudeAsk(opts)));
  },

  async runAgent({ system, messages, tools, runTool, effort = "medium", maxTurns = 8 }) {
    const convo = [...messages];
    const trace = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await claudeAsk({ system, messages: convo, tools, effort });
      convo.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;
      if (response.stop_reason !== "tool_use") return { text: claudeText(response), trace };
      const results = await Promise.all(
        response.content
          .filter((b) => b.type === "tool_use")
          .map(async (block) => {
            try {
              const output = await runTool(block.name, block.input);
              trace.push({ tool: block.name, input: block.input, output });
              return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) };
            } catch (err) {
              trace.push({ tool: block.name, input: block.input, error: err.message });
              return { type: "tool_result", tool_use_id: block.id, content: err.message, is_error: true };
            }
          })
      );
      convo.push({ role: "user", content: results });
    }
    return { text: "I ran out of steps on that one. Could you try rephrasing?", trace };
  },
};

// ---------------- Public API ----------------
function backend() {
  if (modes.ai === "groq") return groq;
  if (modes.ai === "claude") return claude;
  throw new AIUnavailable("AI is in demo mode");
}

export const askJSON = (opts) => backend().askJSON(opts);
export const runAgent = (opts) => backend().runAgent(opts);
