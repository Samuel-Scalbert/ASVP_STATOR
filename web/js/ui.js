/* ASVP Stator — composants d’interface partagés (Preact + htm). */
(function (root) {
  "use strict";
  const { html, useState, useEffect, useRef } = root.htmPreact;
  const C = root.StatorCore;

  /* ---------- Formats ---------- */
  const NNBSP = " ";
  const pct = (r) => (r == null ? "—" : Math.round(r * 100) + NNBSP + "%");
  const signed = (n) => (n > 0 ? "+" + n : n < 0 ? "−" + Math.abs(n) : "0");
  const plural = (n, one, many) => n + " " + (n > 1 ? many : one);
  /* Accorde un libellé au pluriel (« blocs décisifs ») avec un nombre : 0 ou 1 → singulier. */
  const agree = (label, n) => (n > 1 ? label : String(label).split(" ").map((w) => w.replace(/s$/, "")).join(" "));
  function fmtDate(d, opts) {
    if (!d) return "Date à préciser";
    const [y, m, day] = d.split("-").map(Number);
    if (!y || !m || !day) return d;
    try {
      return new Intl.DateTimeFormat("fr-FR", opts || { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(y, m - 1, day));
    } catch (e) { return d; }
  }
  const shortDate = (d) => (d ? fmtDate(d, { day: "numeric", month: "short" }) : "s.d.");

  /* Lien YouTube (youtu.be, watch?v=, live/, shorts/, embed/) -> adresse du lecteur intégré, ou null. */
  function youtubeEmbed(url) {
    let u;
    try { u = new URL(String(url || "").trim()); } catch (e) { return null; }
    let id = null;
    if (/(^|\.)youtu\.be$/.test(u.hostname)) id = u.pathname.slice(1).split("/")[0];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else { const mm = u.pathname.match(/^\/(embed|live|shorts|v)\/([^/?#]+)/); if (mm) id = mm[2]; }
    }
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const t = u.searchParams.get("t") || u.searchParams.get("start") || "";
    const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = hms ? (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0) : 0;
    return "https://www.youtube-nocookie.com/embed/" + id + "?rel=0" + (start ? "&start=" + start : "");
  }
  const cx = (...a) => a.filter(Boolean).join(" ");

  /* ---------- Icônes (traits, 24×24) ---------- */
  const PATHS = {
    cal: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
    chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
    book: "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h9",
    users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5a6.5 6.5 0 0 1 3.5 5.5",
    back: "M15 5l-7 7 7 7",
    next: "M9 5l7 7-7 7",
    plus: "M12 5v14M5 12h14",
    undo: "M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2",
    check: "M5 12.5l4.5 4.5L19 7.5",
    x: "M6 6l12 12M18 6L6 18",
    down: "M12 4v11M7 10l5 5 5-5M5 20h14",
    up: "M12 20V9M7 14l5-5 5 5M5 4h14",
    edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
    trash: "M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3",
    info: "M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    list: "M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5",
    play: "M8 5.5v13l10.5-6.5z",
    moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
    sun: "M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
  };
  function Icon({ name, size }) {
    const s = size || 20;
    return html`<svg class="ico" width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${PATHS[name]} /></svg>`;
  }
  /* ---------- Fenêtre basse (feuille modale) ---------- */
  function Sheet({ title, onClose, children, wide }) {
    const ref = useRef(null);
    useEffect(() => {
      const prev = document.activeElement;
      const t = setTimeout(() => { const el = ref.current && ref.current.querySelector("[data-autofocus], button, input, textarea, select"); if (el) el.focus(); }, 30);
      const onKey = (e) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); if (prev && prev.focus) prev.focus(); };
    }, []);
    return html`<div class="sheet-wrap" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class=${cx("sheet", wide && "wide")} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
        <div class="sheet-head">
          <h2>${title}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Fermer"><${Icon} name="x" /></button>
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>`;
  }

  /* ---------- Toasts ---------- */
  let pushToast = () => {};
  function Toasts() {
    const [items, setItems] = useState([]);
    useEffect(() => {
      pushToast = (text) => {
        const id = Math.random();
        setItems((xs) => xs.concat([{ id, text }]).slice(-3));
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2800);
      };
    }, []);
    return html`<div class="toasts" role="status" aria-live="polite">${items.map((t) => html`<div class="toast" key=${t.id}>${t.text}</div>`)}</div>`;
  }
  const toast = (t) => pushToast(t);

  /* ---------- Cases de comptage ---------- */
  /* Case de comptage : toucher la case ajoute 1, le − du coin retire 1. */
  function Tile({ f, n, onTap, onMinus, label, cell, aria }) {
    return html`<div class=${cx("tile", "l" + f.lvl, cell && "cell", n > 0 && "has")}>
      <button type="button" class="tile-hit" onClick=${onTap} aria-label=${aria + " : " + n + ". Ajouter 1"}>
        ${!cell && html`<span class="tile-l">${label || f.label}</span>`}
        <span class="tile-row">
          <span class="tile-n" key=${n}>${n}</span>
          ${!cell && f.pt ? html`<span class=${cx("tile-pt", f.pt > 0 ? "plus" : "minus")}>${f.pt > 0 ? "+1 pt" : "−1 pt"}</span>` : null}
        </span>
        ${!cell && html`<span class="tile-h">${f.hint}</span>`}
      </button>
      ${n > 0 && onMinus && html`<button type="button" class="tile-minus" onClick=${onMinus} aria-label=${"Retirer 1 : " + aria}>−</button>`}
    </div>`;
  }

  /* ---------- Taux : réussis ÷ total, sans objectif ---------- */
  function RateChip({ r, compact }) {
    if (!r || !r.total) return html`<span class="rate empty">—</span>`;
    return html`<span class="rate" title=${r.ok + " sur " + r.total}>
      <b>${pct(r.rate)}</b>
      ${!compact && html`<span class="rate-n">${r.ok}/${r.total}</span>`}
    </span>`;
  }

  /* Barre empilée : répartition des résultats d’un geste, du meilleur au pire. */
  function DistBar({ skill, r }) {
    const s = C.SKILL[skill];
    const order = Object.keys(s.outcomes).sort((a, b) => s.outcomes[a].lvl - s.outcomes[b].lvl);
    if (!r.total) return html`<div class="dist empty" aria-hidden="true"></div>`;
    return html`<div class="dist" role="img" aria-label=${order.map((o) => r.byO[o] + " " + s.outcomes[o].label.toLowerCase()).join(", ")}>
      ${order.filter((o) => r.byO[o] > 0).map((o) => html`<span key=${o} class=${"seg l" + s.outcomes[o].lvl} style=${{ flexGrow: r.byO[o] }} title=${s.outcomes[o].label + " : " + r.byO[o]}></span>`)}
    </div>`;
  }
  function distText(skill, r) {
    const s = C.SKILL[skill];
    return Object.keys(s.outcomes).filter((o) => r.byO[o] > 0).map((o) => r.byO[o] + " " + s.outcomes[o].label.toLowerCase()).join(" · ");
  }
  function LevelLegend() {
    return html`<ul class="legend" aria-label="Couleurs des résultats">
      ${[1, 2, 3, 4].map((l) => html`<li key=${l}><span class=${"sw l" + l}></span>${C.LEVELS[l]}</li>`)}
    </ul>`;
  }

  /* Jauge d’un taux. */
  function Meter({ r, label, sub }) {
    const w = r.rate == null ? 0 : Math.max(0, Math.min(1, r.rate)) * 100;
    return html`<div class="meter-row">
      <div class="meter-top"><span class="meter-label">${label}</span><${RateChip} r=${r} /></div>
      <div class="meter" role="img" aria-label=${label + " : " + pct(r.rate)}>
        <span class="meter-fill" style=${{ width: w + "%" }}></span>
      </div>
      ${sub && html`<div class="meter-sub">${sub}</div>`}
    </div>`;
  }

  /* ---------- Récapitulatif d’une fiche ---------- */
  function Recap({ sets, title }) {
    const sl = C.scoreLine(sets);
    return html`<section class="recap">
      ${title && html`<h3 class="h-sec">${title}</h3>`}
      <div class="kpis">
        <div class="kpi"><span class="kpi-l">Points marqués</span><span class="kpi-v">${sl.P}</span>
          <span class="kpi-s">Attaque ${sl.pts.attaque} · Service ${sl.pts.service} · Bloc ${sl.pts.bloc}</span></div>
        <div class="kpi"><span class="kpi-l">Fautes</span><span class="kpi-v">${sl.F}</span>
          <span class="kpi-s">Attaque ${sl.flt.attaque} · Service ${sl.flt.service} · Récep. ${sl.flt.reception} · Passe ${sl.flt.passe}</span></div>
        <div class="kpi"><span class="kpi-l">Différence</span><span class=${cx("kpi-v", sl.diff > 0 && "pos", sl.diff < 0 && "neg")}>${signed(sl.diff)}</span>
          <span class="kpi-s">Points marqués − fautes</span></div>
      </div>
      <div class="dist-list">
        ${C.SKILLS.map((s) => {
          const r = C.sumSkill(sets, s.key);
          return html`<div class="dist-row" key=${s.key}>
            <div class="dist-head"><span class="dist-name">${s.label}</span><${RateChip} r=${r} /></div>
            <${DistBar} skill=${s.key} r=${r} />
            <div class="dist-txt">${r.total ? distText(s.key, r) : "Aucune action saisie"}</div>
          </div>`;
        })}
      </div>
      <${LevelLegend} />
    </section>`;
  }

  /* ---------- Graphique : taux match par match (une série) ---------- */
  function RateChart({ title, pts }) {
    const [hover, setHover] = useState(null);
    const W = 320, H = 150, L = 34, R = 14, T = 12, B = 28;
    const n = pts.length;
    const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (1 - v) * (H - T - B);
    const valid = pts.map((p, i) => ({ p, i })).filter((d) => d.p.rate != null);
    let path = "", prev = false;
    pts.forEach((p, i) => {
      if (p.rate == null) { prev = false; return; }
      path += (prev ? "L" : "M") + x(i).toFixed(1) + " " + y(p.rate).toFixed(1);
      prev = true;
    });
    const last = valid[valid.length - 1];
    const onMove = (e) => {
      const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * W;
      let best = null, bd = 1e9;
      valid.forEach((d) => { const dd = Math.abs(x(d.i) - px); if (dd < bd) { bd = dd; best = d.i; } });
      setHover(best);
    };
    const h = hover != null ? pts[hover] : null;
    return html`<figure class="chart">
      <figcaption class="chart-title">${title}</figcaption>
      <div class="chart-box">
        <svg viewBox=${"0 0 " + W + " " + H} role="img" aria-label=${title + " : " + pts.map((p) => p.label + " " + pct(p.rate)).join(", ")}>
          ${[0, 0.5, 1].map((v) => html`<g key=${v}>
            <line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} class="grid" />
            <text x=${L - 6} y=${y(v) + 3.5} class="tick" text-anchor="end">${Math.round(v * 100) + "%"}</text>
          </g>`)}
          ${pts.map((p, i) => html`<text key=${"x" + i} x=${x(i)} y=${H - 9} class="tick" text-anchor=${n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}>${n <= 6 || i % Math.ceil(n / 6) === 0 || i === n - 1 ? p.label : ""}</text>`)}
          ${path && html`<path d=${path} class="line" />`}
          ${hover != null && html`<line x1=${x(hover)} x2=${x(hover)} y1=${T} y2=${H - B} class="cross" />`}
          ${valid.map((d) => html`<circle key=${"c" + d.i} cx=${x(d.i)} cy=${y(d.p.rate)} r=${hover === d.i || d === last ? 5 : 4} class="dot" />`)}
          ${last && html`<text x=${Math.min(x(last.i) + 8, W - R)} y=${y(last.p.rate) - 8} class="end-lbl" text-anchor=${n > 1 ? "end" : "start"}>${pct(last.p.rate)}</text>`}
          <rect x=${L} y=${T} width=${W - L - R} height=${H - T - B} fill="transparent" onPointerMove=${onMove} onPointerLeave=${() => setHover(null)} />
        </svg>
        ${h && html`<div class="tip" style=${{ left: (x(hover) / W) * 100 + "%" }}>
          <b>${pct(h.rate)}</b><span>${h.ok}/${h.total} · ${h.full}</span>
        </div>`}
      </div>
    </figure>`;
  }

  /* Schéma du terrain : numéros de postes (vue depuis l’arrière, filet en haut). */
  function Court() {
    const z = [[4, 0, 0], [3, 1, 0], [2, 2, 0], [5, 0, 1], [6, 1, 1], [1, 2, 1]];
    return html`<svg class="court" viewBox="0 0 240 150" role="img" aria-label="Terrain vu de l’arrière : postes 4, 3 et 2 au filet de gauche à droite, postes 5, 6 et 1 au fond">
      <rect x="10" y="22" width="220" height="120" rx="4" class="court-floor" />
      <line x1="10" y1="22" x2="230" y2="22" class="court-net" />
      <text x="120" y="14" text-anchor="middle" class="court-cap">FILET</text>
      <line x1="10" y1="62" x2="230" y2="62" class="court-line" />
      ${z.map(([n, cxi, row]) => html`<g key=${n}>
        <text x=${10 + 220 / 6 + cxi * (220 / 3)} y=${row ? 108 : 48} text-anchor="middle" class=${row ? "court-n back" : "court-n"}>${n}</text>
      </g>`)}
      <text x="120" y="134" text-anchor="middle" class="court-cap">fond de terrain · zones arrière 5, 6, 1</text>
    </svg>`;
  }

  /* Petite barre divergente pour la différence points − fautes. */
  function DiffBar({ v, max }) {
    const m = Math.max(1, max);
    const w = (Math.min(Math.abs(v), m) / m) * 50;
    return html`<span class="diffbar" aria-hidden="true"><span class="diffbar-mid"></span>
      ${v !== 0 && html`<span class=${cx("diffbar-fill", v > 0 ? "pos" : "neg")} style=${v > 0 ? { left: "50%", width: w + "%" } : { right: "50%", width: w + "%" }}></span>`}
    </span>`;
  }

  root.StatorUI = { pct, signed, plural, agree, fmtDate, shortDate, youtubeEmbed, cx, Icon, Sheet, Toasts, toast, Tile, RateChip, DistBar, distText, LevelLegend, Meter, Recap, RateChart, Court, DiffBar };
})(window);
