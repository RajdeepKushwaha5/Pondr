// Pondr visual kit: mascot, line icons, product illustrations. No emoji in the UI.
(function () {
  const stroke = (d, size = 18) =>
    `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  const paths = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
    drop: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    send: '<path d="M4 12 20 4l-6 16-2.5-6.5L4 12Z"/>',
    reset: '<path d="M4 4v6h6"/><path d="M20 12a8 8 0 1 0-2.3 5.7"/><path d="M4.6 10A8 8 0 0 1 12 4"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    bag: '<path d="M5 8h14l-1.2 12H6.2L5 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13"/><path d="M12 8S10.5 3.5 8 4.5 9 8 12 8Zm0 0s1.5-4.5 4-3.5S15 8 12 8Z"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7Z"/><path d="M4 7V6a2 2 0 0 1 2-2h10v3"/><circle cx="16" cy="13.5" r="1.2"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  };
  const icon = (name, size) => stroke(paths[name] || "", size);

  // Pondr the duck. mood: "calm" | "think" | "happy"
  function duck(size = 64, mood = "calm") {
    const eye = mood === "happy" ? '<path d="M41 22.5q2.2-2.6 4.4 0" stroke="#14161A" stroke-width="2" fill="none" stroke-linecap="round"/>' : '<circle cx="43" cy="22" r="2.3" fill="#14161A"/><circle cx="43.8" cy="21.2" r=".7" fill="#fff"/>';
    const brow = mood === "think" ? '<path d="M39.5 16.8l6-1.4" stroke="#14161A" stroke-width="1.8" stroke-linecap="round"/>' : "";
    return `<svg class="duck" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="58" rx="20" ry="2.6" fill="#14161A" opacity=".08"/>
      <path d="M9 38c0-7 6-11 14-11h8c3-6 1-10 1-13a10 10 0 0 1 20 1c0 4-2 7-2 9 5 3 7 8 6 13-1.4 8-10 13-23 13C17 50 9 46 9 38Z" fill="#F5B83D"/>
      <path d="M20 38c5 4 14 4 19-1" stroke="#D99520" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M51 22.5c3.5-.6 7 .2 9 1.8-2 2.2-5.6 3-9 2.2Z" fill="#E86A33"/>
      ${eye}${brow}
      <circle cx="47.5" cy="28" r="2.6" fill="#F28C6B" opacity=".45"/>
    </svg>`;
  }

  // Product illustrations: flat, two-tone, on a tinted tile.
  const art = {
    headphones: { bg: "#DCE8E3", svg: '<path d="M30 70V58a30 30 0 0 1 60 0v12" stroke="#14161A" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="22" y="62" width="18" height="30" rx="8" fill="#127C8A"/><rect x="80" y="62" width="18" height="30" rx="8" fill="#127C8A"/><rect x="27" y="68" width="8" height="18" rx="4" fill="#0B4F5C"/><rect x="85" y="68" width="8" height="18" rx="4" fill="#0B4F5C"/>' },
    sneakers: { bg: "#F3E1D3", svg: '<path d="M18 84c0-10 4-24 10-30 6 4 14 6 22 4 6 10 20 16 36 18 8 1 14 5 14 10v4H18v-6Z" fill="#E86A33"/><path d="M18 88h82v6H18z" fill="#14161A"/><path d="M40 62l6 8M48 60l6 9M56 62l5 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M28 54c4-6 10-8 16-6" stroke="#14161A" stroke-width="3" fill="none" stroke-linecap="round"/>' },
    lamp: { bg: "#EDE6CF", svg: '<path d="M44 30h32l12 26H32l12-26Z" fill="#F5B83D"/><path d="M60 56v30" stroke="#14161A" stroke-width="5" stroke-linecap="round"/><rect x="42" y="86" width="36" height="8" rx="4" fill="#14161A"/><path d="M48 66l-8 10M72 66l8 10M60 66v12" stroke="#F5B83D" stroke-width="3" stroke-linecap="round" opacity=".6"/>' },
    groceries: { bg: "#DDE7CF", svg: '<path d="M26 54h68l-6 40H32l-6-40Z" fill="#2E7D4F"/><path d="M26 54h68" stroke="#14161A" stroke-width="4" stroke-linecap="round"/><circle cx="48" cy="44" r="10" fill="#E86A33"/><path d="M66 50c0-10 6-18 14-20-1 10-6 18-14 20Z" fill="#7DB05A"/><path d="M58 52V32" stroke="#7DB05A" stroke-width="5" stroke-linecap="round"/><path d="M40 66v16M52 66v16M64 66v16M76 66v16" stroke="#fff" stroke-width="3" opacity=".5" stroke-linecap="round"/>' },
    generic: { bg: "#E7E3DA", svg: '<rect x="30" y="34" width="60" height="56" rx="8" fill="#127C8A"/><path d="M44 34a16 16 0 0 1 32 0" stroke="#14161A" stroke-width="5" fill="none"/>' },
  };
  function productArt(key, h = 180) {
    const a = art[key] || art.generic;
    return `<div class="art" style="background:${a.bg};height:${h}px"><svg viewBox="0 0 120 120" aria-hidden="true">${a.svg}</svg></div>`;
  }

  window.PondrUI = { icon, duck, productArt, art };
})();
