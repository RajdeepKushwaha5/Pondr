// Pondr content script: on checkout-looking pages, the first click on a
// "pay / place order" button shows the duck. A second click goes through.
(() => {
  const PAY_WORDS = /\b(place order|pay now|complete (order|purchase)|buy now|checkout|confirm (order|payment)|pay with|finalizeaz|plăte|trimite comanda)\b/i;
  const PAGE_HINT = /(checkout|cart|basket|payment|order|cos|comanda)/i;
  const MONEY = /(€|EUR|RON|lei|\$|USD|£|GBP)\s?(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?)|(\d{1,3}(?:[.,\s]\d{3})*(?:[.,]\d{2})?)\s?(€|EUR|RON|lei|\$|USD|£|GBP)/gi;
  const CURRENCY = { "€": "EUR", eur: "EUR", ron: "RON", lei: "RON", $: "USD", usd: "USD", "£": "GBP", gbp: "GBP" };

  if (!PAGE_HINT.test(location.href + " " + document.title)) return;

  let server = "http://localhost:3000";
  let passed = false;
  chrome.storage?.sync.get({ server }, (v) => (server = v.server.replace(/\/$/, "")));

  const toNumber = (raw) => {
    let s = raw.replace(/\s/g, "");
    if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    return Number(s);
  };

  // Best guess at the order total: the largest amount on a line mentioning "total", with its
  // currency. The server only supports EUR and rejects anything else instead of guessing.
  function findTotal() {
    const candidates = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length > 3) continue;
      const text = el.textContent || "";
      if (text.length > 120 || !/total/i.test(text)) continue;
      for (const m of text.matchAll(MONEY)) {
        const currency = CURRENCY[(m[1] || m[4] || "").toLowerCase()] || CURRENCY[m[1] || m[4]];
        candidates.push({ amount: toNumber(m[2] || m[3]), currency });
      }
    }
    const valid = candidates.filter((c) => c.amount > 0 && c.amount < 100000 && c.currency);
    if (!valid.length) return null;
    const best = valid.reduce((a, b) => (b.amount > a.amount ? b : a));
    // Mixed currencies on one page: don't guess.
    const mixed = new Set(valid.map((c) => c.currency)).size > 1;
    return { ...best, uncertain: mixed };
  }

  function showDuck({ amount, currency, uncertain }) {
    const frame = document.createElement("iframe");
    frame.src = `${server}/duck-frame.html?amount=${amount}&currency=${currency}&uncertain=${uncertain ? 1 : 0}&title=${encodeURIComponent(document.title.slice(0, 80))}`;
    Object.assign(frame.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", border: "0", zIndex: 2147483647, background: "transparent" });
    frame.allowTransparency = "true";
    document.documentElement.appendChild(frame);
    const onMsg = (e) => {
      if (e.data?.pondr === "close") {
        frame.remove();
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
  }

  document.addEventListener(
    "click",
    (e) => {
      if (passed) return;
      const btn = e.target.closest("button, a, input[type=submit], [role=button]");
      if (!btn) return;
      const label = `${btn.textContent || ""} ${btn.value || ""} ${btn.getAttribute("aria-label") || ""}`;
      if (!PAY_WORDS.test(label)) return;
      const total = findTotal();
      if (!total) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      passed = true; // next click proceeds normally
      showDuck(total);
    },
    true
  );
})();
