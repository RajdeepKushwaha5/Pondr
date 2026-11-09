// Channel3 product search: market prices for Wait & Watch.
// Docs: https://channel3.ai/docs/guides/make-a-search.md
import { config, modes } from "./config.js";

export async function searchMarket(query, { maxPrice, limit = 5 } = {}) {
  if (modes.channel3 === "mock") return mockSearch(query, maxPrice, limit);

  const body = { query, limit, filters: { availability: ["InStock"] } };
  if (maxPrice) body.filters.price = { max_price: maxPrice };
  const res = await fetch(`${config.channel3.apiBase}/search`, {
    method: "POST",
    headers: { "x-api-key": config.channel3.apiKey, "x-user-id": "user_ana", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Channel3 search failed: ${res.status}`);
  const data = await res.json();
  return withComparable({
    source: "channel3",
    results: (data.products || []).map((p) => {
      const offer = [...(p.offers || [])].sort((a, b) => a.price.price - b.price.price)[0];
      return {
        title: p.title,
        brand: p.brands?.[0]?.name,
        price: offer?.price?.price,
        currency: offer?.price?.currency,
        compareAt: offer?.price?.compare_at_price,
        domain: offer?.domain,
        url: offer?.url,
        image: p.images?.find((i) => i.is_main_image)?.cleaned_url || p.images?.[0]?.url,
      };
    }).filter((r) => typeof r.price === "number"),
  });
}

// Only offers in the store's currency are compared numerically; others are shown as context.
function withComparable(market) {
  const comparable = market.results.filter((r) => r.currency === config.currency);
  return {
    ...market,
    storeCurrency: config.currency,
    comparable,
    note: comparable.length === market.results.length ? undefined : `Some offers are in other currencies. Only compare ${config.currency} offers with the store price; do not convert.`,
  };
}

function mockSearch(query, maxPrice, limit) {
  const base = 70 + (query.length % 7) * 6;
  const results = [
    { title: `${query} (market offer A)`, price: base + 9, domain: "example-retailer-a.com" },
    { title: `${query} (market offer B)`, price: base + 3, domain: "example-retailer-b.com" },
    { title: `${query} (market offer C)`, price: base + 14, domain: "example-retailer-c.com" },
  ]
    .filter((r) => !maxPrice || r.price <= maxPrice * 1.25)
    .slice(0, limit)
    .map((r) => ({ ...r, currency: config.currency }));
  return withComparable({ source: "mock", results });
}
