// Pondr checkout duck. Used by the demo store and the browser-extension frame.
// PondrDuck.open({ productId }) for store items, or ({ amount, title, newTab }) for external checkout pages.
(function () {
  const { icon, duck } = window.PondrUI;
  const call = (path, body) =>
    fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      return data;
    });
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => `€${Number(n).toFixed(2).replace(/\.00$/, "")}`;

  function sheet(inner, mood = "calm") {
    close();
    const el = document.createElement("div");
    el.className = "duck-backdrop";
    el.id = "pondr-duck";
    el.innerHTML = `<div class="duck-modal" role="dialog" aria-modal="true" aria-label="Pondr">
      <div class="duck-peek">${duck(76, mood)}</div>
      <button class="duck-close" aria-label="Close">${icon("x", 16)}</button>${inner}</div>`;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
    el.querySelector(".duck-close").onclick = close;
    document.addEventListener("keydown", onKey);
    document.body.appendChild(el);
    return el;
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function close() {
    document.getElementById("pondr-duck")?.remove();
    document.removeEventListener("keydown", onKey);
  }

  const choice = (act, ic, title, sub, amt, primary) =>
    `<button class="choice ${primary ? "primary" : ""}" data-act="${act}"><span class="ci">${icon(ic, 18)}</span><span><b>${title}</b><small>${sub}</small></span>${amt ? `<span class="amt">${amt}</span>` : ""}</button>`;

  const foot = (source) => {
    const pp = window.PONDR_MODES?.paypal === "sandbox" ? "PayPal sandbox" : "PayPal mock";
    const src = window.PONDR_STATE_SRC || "";
    return `<div class="duck-foot">${icon("shield", 13)} ${src}Math by Pondr · words by ${source === "ai" ? window.PONDR_MODES?.aiName || "AI" : "templates"} · ${pp} · no real money</div>`;
  };

  async function open(opts) {
    // The extension couldn't read the currency reliably: ask instead of guessing.
    if (opts.uncertain && !opts.confirmed) {
      const el = sheet(`<span class="eyebrow">Quick check</span><h3>Is this cart <em>${money(opts.amount)}</em>?</h3>
        <p>This page shows more than one currency, so I'm not sure I read the total right.</p>
        <div class="choices">${choice("yes", "check", "Yes, that's right", "Continue in euros", "", true)}${choice("close", "x", "No, it's different", "Close Pondr for this page")}</div>`, "think");
      el.querySelector('[data-act="yes"]').onclick = () => open({ ...opts, confirmed: true });
      el.querySelector('[data-act="close"]').onclick = close;
      return;
    }
    sheet(`<span class="eyebrow">One sec</span><h3>Pondering <em>this</em> one…</h3><p>Checking it against your goals.</p><div class="typing"><i></i><i></i><i></i></div>`, "think");
    let d;
    try {
      d = await call("/api/duck", opts.productId ? { productId: opts.productId } : { amount: opts.amount, title: opts.title, currency: opts.currency });
    } catch (err) {
      return sheet(`<span class="eyebrow">Hmm</span><h3>Couldn't reach Pondr</h3><p>${h(err.message)}</p>`);
    }
    const item = d.item;
    window.PONDR_STATE_SRC = d.facts?.savingPaceSource ? `Saving pace: ${d.facts.savingPaceSource} · ` : "";
    const isStore = !!item.id;

    if (!d.intervene) {
      const el = sheet(`<span class="eyebrow">All clear</span><h3>Looks good, <em>go ahead.</em></h3>
        <p>${h(d.quietReason || "This one barely moves your goals, so I'll stay out of the way.")}</p>
        <div class="choices">${isStore ? choice("buy", "arrow", "Continue to PayPal", "Pay as normal", money(item.price), true) : choice("close", "arrow", "Continue", "Back to checkout", "", true)}</div>
        ${foot(d.source)}`, "happy");
      return bind(el, item, opts);
    }

    const f = d.facts;
    const now = Math.min(100, (f.pond.balance / f.pond.target) * 100);
    const add = Math.max(0, Math.min(100, (f.pondProgressIfPonded || 0)) - now);
    const headline = h(d.headline).replace(/(\d+\s+days?)/, "<em>$1</em>");
    const el = sheet(`<span class="eyebrow">Before you pay</span>
      <h3>${headline}</h3>
      <p>${h(d.message)}</p>
      ${d.reasons?.length ? `<ul class="reasons">${d.reasons.map((r) => `<li>${h(r)}</li>`).join("")}</ul>` : ""}
      <div class="meter">
        <div class="meter-track"><div class="now" style="width:${now}%"></div><div class="add" style="left:${now}%;width:${add}%"></div></div>
        <div class="meter-legend"><span>${h(f.pond.name)} ${Math.round(now)}%</span><span>→ ${f.pondProgressIfPonded}% if ponded</span></div>
      </div>
      <div class="choices">
        ${choice("pond", "drop", "Pond it", `Still press pay. Tracked in your ${h(f.pond.name)} ledger.`, money(item.price), true)}
        ${isStore ? choice("watch", "eye", "Wait &amp; Watch", "Set your rules. I'll prepare it only if they're met.") : ""}
        ${isStore ? choice("buy", "bag", "Buy it now", "Your call. No judgement.", money(item.price)) : choice("close", "arrow", "Not now", "Continue on this site")}
      </div>
      <div class="payee">${icon("wallet", 13)} Sandbox payee: ${h(d.merchant || "Pondr Demo Merchant")}. Ponds are an app ledger in this prototype.</div>
      ${foot(d.source)}`, "think");
    bind(el, item, opts);
  }

  function bind(el, item, opts) {
    el.querySelectorAll("[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const act = b.dataset.act;
        if (act === "close") return close();
        if (act === "watch") return watchForm(item);
        b.disabled = true;
        try {
          const r = await call("/api/checkout", item.id ? { productId: item.id, choice: act } : { amount: item.price, title: item.name, currency: opts.currency, choice: act });
          if (opts.newTab) {
            window.open(r.approveUrl, "_blank", "noopener");
            sheet(`<span class="eyebrow">Almost there</span><h3>Finish in the <em>PayPal</em> tab.</h3><p>Your pond fills the moment PayPal confirms the payment.</p>`, "happy");
          } else {
            window.location.href = r.approveUrl;
          }
        } catch (err) {
          b.disabled = false;
          alert(err.message);
        }
      })
    );
  }

  function watchForm(item) {
    const suggested = Math.floor(item.price * 0.85);
    const el = sheet(`<span class="eyebrow">Wait &amp; Watch</span>
      <h3>Name your <em>price.</em></h3>
      <p>Pondr's agent watches <b>${h(item.name)}</b> at the Pondr Demo Store. It prepares a PayPal order only when the price, your cooling-off time and your fun budget all check out. Nothing is paid until you approve.</p>
      <form class="watch-form">
        <label class="field">Buy it at or below
          <div class="range-row"><input name="max" type="range" min="${Math.ceil(item.price * 0.5)}" max="${item.listPrice}" step="1" value="${suggested}"><output>${money(suggested)}</output></div>
        </label>
        <div class="two">
          <label class="field">Within (days)<input name="days" type="number" min="1" max="365" value="30"></label>
          <label class="field">Cooling-off (hours)<input name="cool" type="number" min="0" max="168" value="24"></label>
        </div>
        <label class="field">Only once my pond is at least (%)<input name="pct" type="number" min="0" max="100" value="0"></label>
        <button class="btn dark" type="submit">${icon("eye", 16)} Start watching</button>
      </form>`, "calm");
    const range = el.querySelector("input[type=range]");
    range.oninput = () => (el.querySelector("output").textContent = money(range.value));
    el.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const m = await call("/api/mandates", { product_id: item.id, max_price: Number(fd.get("max")), deadline_days: Number(fd.get("days")), cool_off_hours: Number(fd.get("cool")), min_pond_progress_pct: Number(fd.get("pct")) });
        const done = sheet(`<span class="eyebrow">Watching</span><h3>Deal. I'll <em>keep an eye</em> on it.</h3>
          <p>After a ${m.coolOffHours}h cooling-off, if <b>${h(m.productName)}</b> is ${money(m.maxPrice)} or less and fits your fun budget, you'll get a PayPal order to approve. Changed your mind? Let it go anytime.</p>
          <div class="choices">${'<a class="choice primary" href="/app.html"><span class="ci">' + icon("eye", 18) + "</span><span><b>See my watches</b><small>Your Wait &amp; Watch list</small></span></a>"}</div>`, "happy");
        done.querySelector(".choice").focus();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  window.PondrDuck = { open, close };
})();
