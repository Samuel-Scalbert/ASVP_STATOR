/* ASVP Stator — préparation d’un match par le coach : compo sur le terrain, compos types, binômes, consignes,
   page du match à venir. Une compo = six joueurs sur le terrain et un libéro ; c’est une compo fixe, sans rotation. */
(function (root) {
  "use strict";
  const { html, useState } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, cx, plural, fmtDate, fmtTime, TeamLogo } = U;

  /* ---------- Modèle ---------- */
  // Les six places du terrain, vues de notre fond : trois au filet, trois à l’arrière.
  const SLOTS = [
    { p: 4, row: "front", label: "Filet · gauche" }, { p: 3, row: "front", label: "Filet · centre" }, { p: 2, row: "front", label: "Filet · droite" },
    { p: 5, row: "back", label: "Arrière · gauche" }, { p: 6, row: "back", label: "Arrière · centre" }, { p: 1, row: "back", label: "Arrière · droite" },
  ];
  const POS = [1, 2, 3, 4, 5, 6];
  const ROLE_ORDER = ["passeur", "pointu", "r4", "central", "libero"];
  const roleLabel = (k) => { const r = C.ROLES.find((x) => x.k === k); return r ? r.label : ""; };
  const posteOf = (id) => { const p = q.roster().find((x) => x.id === id); return (p && p.poste) || ""; };
  const emptyLineup = (label) => ({ label, positions: {}, libero: "", pairs: [], comment: "" });
  const onCourt = (lu) => POS.map((p) => lu.positions[p]).concat([lu.libero]).filter(Boolean);
  /* Joueurs à placer, groupés par poste dans l’ordre du jeu. */
  function grouped(players) {
    const ps = players.map((p) => ({ id: p.id, name: p.name, poste: posteOf(p.id) }));
    return ROLE_ORDER.concat([""]).map((k) => ({ k, label: k ? roleLabel(k) : "Sans poste", players: ps.filter((p) => p.poste === k) })).filter((g) => g.players.length);
  }
  const partnerIn = (lu, id) => { const pr = (lu.pairs || []).find((x) => x.includes(id)); return pr ? pr.find((x) => x !== id) : ""; };
  /* Remplaçants : les joueurs qui ne sont ni sur le terrain ni libéro, avec leur binôme s’il joue. */
  function bench(lu, players) {
    const on = new Set(onCourt(lu));
    return players.filter((p) => !on.has(p.id)).map((p) => { const partner = partnerIn(lu, p.id); return { id: p.id, name: p.name, poste: posteOf(p.id), partner: partner && on.has(partner) ? partner : "" }; });
  }
  /* Échauffement : une heure avant le match. */
  function warmup(time) {
    const m = /^(\d{2}):(\d{2})$/.exec(time || "");
    if (!m) return "";
    const h = (Number(m[1]) + 23) % 24;
    return String(h).padStart(2, "0") + ":" + m[2];
  }
  const cloneLineup = (x) => ({ label: x.label || "", positions: Object.assign({}, x.positions || {}), libero: x.libero || "", pairs: (x.pairs || []).map((p) => p.slice()), comment: x.comment || "" });

  /* ---------- Terrain ---------- */
  /* Une case du terrain : le poste en en-tête (couleur du poste), le nom du joueur et son binôme. */
  function Tile({ id, slot, libero, editor, players, lu, onPick, onPair }) {
    const poste = libero ? "libero" : posteOf(id);
    const head = libero ? "Libéro" : id ? (roleLabel(poste) || "Poste ?") : slot.label;
    const partner = id ? partnerIn(lu, id) : "";
    if (editor) {
      const on = onCourt(lu), taken = new Set(on.filter((x) => x !== id));
      const opts = libero ? [{ k: "", label: "", players: players.filter((p) => !taken.has(p.id)).map((p) => ({ id: p.id, name: p.name, poste: posteOf(p.id) })) }] : grouped(players);
      // Binôme : un remplaçant qui n’est pas déjà en binôme, ceux du même poste en premier.
      const paired = new Set([].concat.apply([], lu.pairs || []));
      const candidates = players.filter((p) => !on.includes(p.id) && !paired.has(p.id))
        .sort((x, y) => (posteOf(x.id) === poste ? 0 : 1) - (posteOf(y.id) === poste ? 0 : 1));
      return html`<div class=${cx("vb-pos edit", "pos-" + (poste || "none"), id && "set", libero && "lib")}>
        <span class="vb-head">${head}</span>
        <select value=${id || ""} aria-label=${libero ? "Libéro" : "Joueur " + slot.label.toLowerCase()} onChange=${(e) => onPick(e.target.value)}>
          <option value="">— libre —</option>
          ${libero
            ? opts[0].players.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)
            : opts.map((g) => html`<optgroup key=${g.k} label=${g.label}>${g.players.map((x) => html`<option key=${x.id} value=${x.id} disabled=${taken.has(x.id)}>${x.name}${taken.has(x.id) ? " (déjà placé)" : ""}</option>`)}</optgroup>`)}
        </select>
        ${!id ? null : partner
          ? html`<span class="vb-pair-chip" title="Binôme"><${Icon} name="swap" size=${13} /><span>${q.name(partner)}</span>
              <button type="button" aria-label=${"Retirer le binôme " + q.name(partner)} onClick=${() => onPair(id, "")}><${Icon} name="x" size=${13} /></button></span>`
          : candidates.length ? html`<select class="vb-pair-sel" value="" aria-label=${"Binôme de " + q.name(id)} onChange=${(e) => onPair(id, e.target.value)}>
              <option value="">+ binôme</option>
              ${candidates.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}${posteOf(x.id) ? " · " + roleLabel(posteOf(x.id)) : ""}</option>`)}
            </select>` : null}
      </div>`;
    }
    return html`<div class=${cx("vb-pos", "pos-" + (id ? poste || "none" : "empty"), libero && "lib")}>
      <span class="vb-head">${head}</span>
      <b class="vb-name">${id ? q.name(id) : "—"}</b>
      ${partner ? html`<small class="vb-pair" title="Binôme"><${Icon} name="swap" size=${12} />${q.name(partner)}</small>` : null}
    </div>`;
  }
  /* Le terrain vu de notre fond, filet en haut ; le libéro à côté, à la hauteur de la rangée arrière. */
  function Court({ lu, editor, onPick, onPair, players }) {
    const tile = (s) => html`<${Tile} key=${s.p} slot=${s} id=${lu.positions[s.p] || ""} editor=${editor} players=${players} lu=${lu} onPick=${(id) => onPick(s.p, id)} onPair=${onPair} />`;
    return html`<div class="vb-wrap">
      <div class="vb-court" role="group" aria-label="Terrain">
        <div class="vb-net"><span>Filet</span></div>
        <div class="vb-row">${SLOTS.filter((s) => s.row === "front").map(tile)}</div>
        <div class="vb-attack"><span>3 m</span></div>
        <div class="vb-row back">${SLOTS.filter((s) => s.row === "back").map(tile)}
          <div class="vb-libero"><${Tile} slot=${{ label: "Libéro" }} id=${lu.libero || ""} libero editor=${editor} players=${players} lu=${lu} onPick=${(id) => onPick("libero", id)} onPair=${onPair} /></div>
        </div>
      </div>
    </div>`;
  }
  function Bench({ lu, players }) {
    const list = bench(lu, players);
    if (!list.length) return null;
    return html`<div class="vb-bench">
      <span class="eyebrow">Remplaçants</span>
      <ul>${list.map((p) => html`<li key=${p.id} class=${"pos-" + (p.poste || "none")}><span class="vb-dot"></span><b>${p.name}</b><small>${roleLabel(p.poste) || ""}</small>${p.partner ? html`<span class="vb-pair" title="Binôme"><${Icon} name="swap" size=${13} />${q.name(p.partner)}</span>` : null}</li>`)}</ul>
    </div>`;
  }
  /* Une compo en lecture : terrain (avec les binômes), commentaire, remplaçants. */
  function LineupView({ lu, players }) {
    return html`<div class="vb-view">
      <${Court} lu=${lu} players=${players} />
      ${lu.comment ? html`<p class="vb-comment"><${Icon} name="info" size=${16} /><span>${lu.comment}</span></p>` : null}
      <${Bench} lu=${lu} players=${players} />
    </div>`;
  }

  /* ---------- Éditeur : compo d’un match (m) ou compo type (template, null = nouvelle) ---------- */
  function LineupEditor({ m, template, onDone }) {
    const isTemplate = m === undefined;
    const players = isTemplate ? q.active() : q.playersOf(m.id);
    const [lineups, setLineups] = useState(() => (isTemplate ? [cloneLineup(template || emptyLineup(""))] : (m.lineups && m.lineups.length ? m.lineups.map(cloneLineup) : [emptyLineup("Set 1")])));
    const [cur, setCur] = useState(0);
    const [name, setName] = useState(template ? template.name : "");
    const [tplChoice, setTplChoice] = useState("");
    const [saveAs, setSaveAs] = useState("");
    const lu = lineups[cur];
    // Mises à jour fonctionnelles : deux changements dans la même seconde ne s’écrasent pas.
    const update = (patch) => setLineups((prev) => prev.map((x, i) => (i === cur ? Object.assign({}, x, patch) : x)));
    const pick = (p, id) => {
      if (p === "libero") { update({ libero: id }); return; }
      const positions = Object.assign({}, lu.positions);
      if (id) positions[p] = id; else delete positions[p];
      update({ positions });
    };
    // Binôme d’un joueur du terrain : on le remplace (other) ou on le retire (other vide).
    const pair = (id, other) => setLineups((prev) => prev.map((x, i) => {
      if (i !== cur) return x;
      const pairs = (x.pairs || []).filter((pr) => !pr.includes(id) && !(other && pr.includes(other)));
      return Object.assign({}, x, { pairs: other ? pairs.concat([[id, other]]) : pairs });
    }));
    const apply = (tpl) => { if (tpl) update({ positions: Object.assign({}, tpl.positions), libero: tpl.libero || "", pairs: (tpl.pairs || []).map((x) => x.slice()), comment: lu.comment || tpl.comment || "" }); };
    const add = () => { if (lineups.length < 4) { setLineups(lineups.concat([emptyLineup("Set " + (lineups.length + 1))])); setCur(lineups.length); } };
    const remove = () => { const next = lineups.filter((_, i) => i !== cur); setLineups(next.length ? next : [emptyLineup("Set 1")]); setCur(0); };
    const clean = (x) => ({ label: (x.label || "").trim(), positions: x.positions, libero: x.libero || "", pairs: x.pairs || [], comment: (x.comment || "").trim() });
    const saveTemplate = (tplName) => {
      const list = q.templates().slice();
      const id = template ? template.id : C.uid("t-");
      const doc = Object.assign({ id, name: tplName.trim() }, clean(lu));
      const i = list.findIndex((t) => t.id === id);
      if (i >= 0) list[i] = doc; else list.push(doc);
      api.saveConfig(Object.assign({}, store.config, { templates: list }));
      return doc;
    };
    const save = () => {
      if (isTemplate) {
        if (!name.trim()) { U.toast("Donne un nom à la compo type."); return; }
        saveTemplate(name);
        onDone(1);
        return;
      }
      const list = lineups.map(clean).filter((x) => Object.keys(x.positions).length || x.libero);
      api.saveMatch(Object.assign({}, store.matches[m.id] || m, { lineups: list, updatedAt: new Date().toISOString() }));
      onDone(list.length);
    };
    const templates = q.templates();
    return html`<div class="lineup-editor">
      ${isTemplate
        ? html`<div class="field"><label for="tpl-name"><b>Nom de la compo type</b><small>ex. Équipe type, Sans Kévin, 6 avec 2 passeurs</small></label><input id="tpl-name" value=${name} maxlength="40" onInput=${(e) => setName(e.target.value)} data-autofocus /></div>`
        : html`
        <div class="lu-tabs" role="tablist">
          ${lineups.map((x, i) => html`<button type="button" key=${i} role="tab" aria-selected=${i === cur} class=${cx("lu-tab", i === cur && "on")} onClick=${() => setCur(i)}>${x.label || "Compo " + (i + 1)}</button>`)}
          ${lineups.length < 4 && html`<button type="button" class="lu-tab add" onClick=${add} aria-label="Ajouter une compo"><${Icon} name="plus" size=${14} />Compo</button>`}
        </div>
        <div class="field-row">
          <div class="field"><label for="lu-label"><b>Nom de la compo</b><small>ex. Set 1, Si Kévin absent</small></label><input id="lu-label" value=${lu.label || ""} maxlength="40" onInput=${(e) => update({ label: e.target.value })} /></div>
          <div class="field"><label for="lu-tpl"><b>Partir d’une compo type</b><small>${templates.length ? "réglées dans l’onglet Équipe" : "aucune pour l’instant (onglet Équipe)"}</small></label>
            <div class="add-row">
              <select id="lu-tpl" value=${tplChoice} disabled=${!templates.length} onChange=${(e) => setTplChoice(e.target.value)}><option value="">${templates.length ? "Choisir…" : "—"}</option>${templates.map((t) => html`<option key=${t.id} value=${t.id}>${t.name}</option>`)}</select>
              <button type="button" class="btn ghost sm" disabled=${!tplChoice} onClick=${() => { apply(templates.find((t) => t.id === tplChoice)); U.toast("Compo type appliquée."); }}>Appliquer</button>
            </div></div>
        </div>`}
      <p class="muted small">Place les six joueurs sur le terrain et le libéro à côté (les listes sont rangées par poste). « + binôme » sous un joueur lui associe un remplaçant au profil proche.</p>
      <${Court} lu=${lu} editor players=${players} onPick=${pick} onPair=${pair} />
      <div class="field"><label for="lu-comment"><b>Commentaire du coach</b><small>sur cette compo</small></label>
        <textarea id="lu-comment" rows="3" maxlength="1000" value=${lu.comment || ""} onInput=${(e) => update({ comment: e.target.value })} placeholder="ex. Kévin et Lucas permutent si la réception souffre"></textarea></div>
      ${!isTemplate && html`<div class="field lu-saveas"><span class="lbl"><b>Garder cette compo comme compo type</b><small>pour la réutiliser sur d’autres matchs</small></span>
        <div class="add-row"><input value=${saveAs} maxlength="40" placeholder="Nom de la compo type" aria-label="Nom de la compo type" onInput=${(e) => setSaveAs(e.target.value)} />
          <button type="button" class="btn ghost sm" disabled=${!saveAs.trim() || !onCourt(lu).length} onClick=${() => { saveTemplate(saveAs); setSaveAs(""); U.toast("Compo type « " + saveAs.trim() + " » enregistrée."); }}>Enregistrer la compo type</button></div></div>`}
      <div class="row-btns end">
        ${!isTemplate && (lineups.length > 1 || onCourt(lu).length) ? html`<button type="button" class="btn ghost" onClick=${remove}><${Icon} name="trash" size=${16} />Supprimer cette compo</button>` : null}
        <button type="button" class="btn primary" onClick=${save}><${Icon} name="check" size=${18} />Enregistrer</button>
      </div>
    </div>`;
  }

  /* ---------- Consignes du coach : une liste à priorités, du rouge au vert ---------- */
  const LEVELS = [{ k: 1, label: "Essentiel", short: "Rouge" }, { k: 2, label: "Important", short: "Orange" }, { k: 3, label: "Bon à savoir", short: "Vert" }];
  const byLevel = (items) => items.slice().sort((a, b) => a.level - b.level);
  function ConsignesView({ items }) {
    return html`<ol class="consignes">${byLevel(items).map((c, i) => html`<li key=${i} class=${"lvl-" + c.level}><span class="cs-badge">${LEVELS[c.level - 1].label}</span><span class="cs-text">${c.text}</span></li>`)}</ol>`;
  }
  function ConsignesEditor({ m, onDone }) {
    const [items, setItems] = useState(() => (m.consignes && m.consignes.length ? m.consignes.map((c) => Object.assign({}, c)) : [{ text: "", level: 1 }]));
    const set = (i, patch) => setItems((prev) => prev.map((c, j) => (j === i ? Object.assign({}, c, patch) : c)));
    const save = () => {
      const list = items.map((c) => ({ text: (c.text || "").trim(), level: c.level })).filter((c) => c.text);
      api.saveMatch(Object.assign({}, store.matches[m.id] || m, { consignes: list, updatedAt: new Date().toISOString() }));
      onDone(list.length);
    };
    return html`<div class="note-editor">
      <p class="muted small">Une consigne par ligne, avec sa priorité : <b class="cs-ink-1">rouge</b> pour l’essentiel, <b class="cs-ink-2">orange</b> pour l’important, <b class="cs-ink-3">vert</b> pour le bon à savoir. Elles s’affichent en tête de la fiche du match, pour toute l’équipe.</p>
      <ul class="cs-rows">${items.map((c, i) => html`<li key=${i} class=${"lvl-" + c.level}>
        <div class="cs-levels" role="group" aria-label="Priorité">${LEVELS.map((l) => html`<button type="button" key=${l.k} class=${cx("cs-lvl", "lvl-" + l.k, c.level === l.k && "on")} aria-pressed=${c.level === l.k} title=${l.label} onClick=${() => set(i, { level: l.k })}>${l.short.charAt(0)}</button>`)}</div>
        <input value=${c.text} maxlength="300" placeholder=${["Service long sur leur passeur", "Bloc fermé sur le pointu", "On parle en défense"][i % 3]} aria-label=${"Consigne " + (i + 1)} onInput=${(e) => set(i, { text: e.target.value })} />
        <button type="button" class="icon-btn" aria-label="Retirer cette consigne" onClick=${() => setItems((prev) => prev.filter((_, j) => j !== i))}><${Icon} name="x" size=${16} /></button>
      </li>`)}</ul>
      <div class="row-btns">
        ${items.length < 30 && html`<button type="button" class="btn ghost sm" onClick=${() => setItems((prev) => prev.concat([{ text: "", level: 2 }]))}><${Icon} name="plus" size=${16} />Ajouter une consigne</button>`}
      </div>
      ${items.some((c) => c.text.trim()) ? html`<div class="note-preview"><span class="eyebrow">Aperçu, du rouge au vert</span><${ConsignesView} items=${items.filter((c) => c.text.trim())} /></div>` : null}
      <div class="row-btns end"><button type="button" class="btn primary" onClick=${save}><${Icon} name="check" size=${18} />Enregistrer</button></div>
    </div>`;
  }

  /* ---------- Cartes « Préparation » (consignes + compo), sur la page d’un match ---------- */
  function ConsignesCard({ m, openSheet, prominent }) {
    const items = m.consignes || [];
    const edit = !store.readOnly && html`<button class="btn ghost sm" onClick=${() => openSheet({ type: "consignes", m })}><${Icon} name="edit" size=${16} />${items.length ? "Modifier" : "Écrire les consignes"}</button>`;
    return html`<section class=${cx("card prep-card consignes-card", prominent && "prominent")}>
      <div class="block-head"><h2 class="h-sec"><${Icon} name="flag" size=${20} />Consignes du coach</h2>${edit}</div>
      ${items.length ? html`<${ConsignesView} items=${items} />` : html`<p class="muted">Pas encore de consignes. Le coach note ici le plan de jeu, par priorité : rouge, orange, vert.</p>`}
    </section>`;
  }
  function LineupCard({ m, openSheet, compact }) {
    const lineups = m.lineups || [];
    const [cur, setCur] = useState(0);
    const lu = lineups[Math.min(cur, lineups.length - 1)];
    const players = q.playersOf(m.id);
    const edit = !store.readOnly && html`<button class="btn ghost sm" onClick=${() => openSheet({ type: "lineup", m })}><${Icon} name="edit" size=${16} />${lineups.length ? "Modifier" : "Faire la compo"}</button>`;
    return html`<section class="card prep-card">
      <div class="block-head"><h2 class="h-sec">Compo du coach</h2>${edit}</div>
      ${lineups.length ? html`
        ${lineups.length > 1 && html`<div class="lu-tabs" role="tablist">${lineups.map((x, i) => html`<button type="button" key=${i} role="tab" aria-selected=${i === cur} class=${cx("lu-tab", i === cur && "on")} onClick=${() => setCur(i)}>${x.label || "Compo " + (i + 1)}</button>`)}</div>`}
        ${lineups.length === 1 && lu.label ? html`<span class="eyebrow">${lu.label}</span>` : null}
        <${LineupView} lu=${lu} players=${players} key=${cur} />`
        : html`<p class="muted">${compact ? "Pas de compo enregistrée pour ce match." : "Le coach n’a pas encore annoncé sa compo. Les six de départ et le libéro s’afficheront ici, sur le terrain, avec les remplaçants et les binômes."}</p>`}
    </section>`;
  }
  const hasPrep = (m) => !!((m.lineups && m.lineups.length) || (m.consignes && m.consignes.length));
  /* Binôme d’un joueur dans les compos d’un match (pour la liste des convoqués). */
  function partnerOf(m, id) {
    for (const lu of m.lineups || []) { const p = partnerIn(lu, id); if (p) return p; }
    return "";
  }

  /* ---------- Page d’un match à venir ---------- */
  function daysUntil(day) {
    const [y, mo, d] = day.split("-").map(Number), [ty, tmo, td] = C.todayIso().split("-").map(Number);
    return Math.round((new Date(y, mo - 1, d) - new Date(ty, tmo - 1, td)) / 864e5);
  }
  const venueLabel = (v) => (v === "dom" ? "À domicile" : v === "ext" ? "À l’extérieur" : "");
  function Upcoming({ m, go, openSheet }) {
    const LG = root.StatorLeague;
    const info = LG ? LG.fixtureInfo(m) : null; // salle, adresse, maillots, classement de l’adversaire (site FFVolley)
    const k = daysUntil(m.date);
    const players = q.playersOf(m.id);
    const groups = grouped(players);
    const gym = info && info.gym;
    const warm = warmup(m.time);
    return html`<div>
      <section class="match-band upcoming-band">
        <div class="match-band-in">
          <button class="icon-btn on-band" onClick=${() => go({ view: "home" })} aria-label="Retour aux matchs"><${Icon} name="back" /></button>
          <div class="mb-main">
            <span class="eyebrow on-band">Match à venir · ${k === 0 ? "aujourd’hui" : k === 1 ? "demain" : "J-" + k}${m.competition ? " · " + m.competition : ""}</span>
            <div class="board sm"><span class="board-team"><${TeamLogo} name="ASVP" size=${36} />ASVP</span><span class="board-vs">vs</span><span class="board-team opp">${m.opponent}<${TeamLogo} name=${m.opponent} size=${36} /></span></div>
            <div class="up-when">
              <span class="up-date"><${Icon} name="cal" size=${18} />${fmtDate(m.date, { weekday: "long", day: "numeric", month: "long" })}${m.time ? html` · <b>${fmtTime(m.time)}</b>` : html` · <i>heure à préciser</i>`}</span>
              <span class="up-warm"><${Icon} name="ball" size=${18} />Échauffement ${warm ? html`à <b>${fmtTime(warm)}</b>` : html`<b>1 h avant</b>`}</span>
              <span class="up-place"><${Icon} name="pin" size=${18} />${venueLabel(m.venue) || "Lieu à préciser"}${gym ? html` · <b>${gym.name}</b>` : null}</span>
            </div>
          </div>
        </div>
        <div class="match-actions">
          ${!store.readOnly && html`<button class="btn primary sm" onClick=${() => openSheet({ type: "consignes", m })}><${Icon} name="flag" size=${16} />${m.consignes && m.consignes.length ? "Modifier les consignes" : "Écrire les consignes"}</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "lineup", m })}><${Icon} name="grid" size=${16} />${m.lineups && m.lineups.length ? "Modifier la compo" : "Faire la compo"}</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "match-form", m })}><${Icon} name="edit" size=${16} />Date, lieu, joueurs</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "delete", m })} aria-label="Supprimer le match"><${Icon} name="trash" size=${16} /></button>`}
        </div>
      </section>
      <div class="page wide">
        <${ConsignesCard} m=${m} openSheet=${openSheet} prominent />
        <div class="summary-grid">
        <div class="col">
          <${LineupCard} m=${m} openSheet=${openSheet} />
        </div>
        <div class="col">
          <section class="card up-info">
            <h2 class="h-sec">Infos pratiques</h2>
            <dl class="up-facts">
              <div><dt>Quand</dt><dd><b>${fmtDate(m.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>${m.time ? html`, match à ${fmtTime(m.time)}` : html`, <span class="warn">heure à préciser</span>`}</dd></div>
              <div><dt>Chauffe</dt><dd>${warm ? html`<b>${fmtTime(warm)}</b>, ` : ""}une heure avant le match : on arrive en tenue.</dd></div>
              <div><dt>Où</dt><dd>${gym ? html`<b>${gym.name}</b>${gym.address ? html`<br />${gym.address}` : null}<br /><a class="btn ghost sm up-maps" href=${gym.maps} target="_blank" rel="noopener noreferrer"><${Icon} name="pin" size=${15} />Itinéraire</a>` : html`${venueLabel(m.venue) || html`<span class="warn">Lieu à préciser</span>`}${m.venue === "ext" ? html` <span class="muted">· salle à confirmer</span>` : null}`}</dd></div>
              ${info && (info.ourColors || info.theirColors) ? html`<div><dt>Maillots</dt><dd>ASVP <b>${(info.ourColors || "?").toLowerCase()}</b> · ${m.opponent} <b>${(info.theirColors || "?").toLowerCase()}</b>${info.ourColors && info.theirColors && /bleu/i.test(info.ourColors) && /bleu/i.test(info.theirColors) ? html` <span class="warn">— couleurs proches, prévoir le second jeu</span>` : null}</dd></div>` : null}
              ${info && info.code ? html`<div><dt>Championnat</dt><dd>${info.title} · match ${info.code}${info.round ? ", journée " + info.round : ""}</dd></div>` : null}
            </dl>
          </section>
          ${info && info.rank ? html`<section class="card up-opp">
            <div class="block-head"><h2 class="h-sec"><${TeamLogo} name=${m.opponent} size=${30} />L’adversaire</h2><span class="rank-chip">${LG.ordinal(info.rank)} sur ${info.teams}</span></div>
            <div class="tm-kpis">
              <div class="tm-kpi"><b>${info.pts}</b><small>${info.pts > 1 ? "points" : "point"} au classement</small></div>
              <div class="tm-kpi"><b>${info.v}–${info.d}</b><small>victoires – défaites</small></div>
              <div class="tm-kpi"><b>${info.sw}–${info.sl}</b><small>sets</small></div>
            </div>
            ${info.last ? html`<p class="small">Dernier match : <b>${info.last}</b></p>` : null}
            ${info.h2h ? html`<p class="small">Contre nous : ${info.h2h}</p>` : null}
            <button class="btn ghost sm" onClick=${() => openSheet({ type: "team", team: info.team })}>Fiche complète de ${m.opponent}</button>
          </section>` : null}
          <section class="card">
            <div class="block-head"><h2 class="h-sec">Joueurs convoqués</h2><span class="muted">${plural(players.length, "joueur", "joueurs")}</span></div>
            ${q.squadOf(m.id) ? null : html`<p class="muted small">Tout l’effectif, tant que le coach n’a pas fait sa sélection (« Date, lieu, joueurs »).</p>`}
            <div class="up-squad">${groups.map((g) => html`<div key=${g.k} class=${"pos-" + (g.k || "none")}><span class="eyebrow"><span class="vb-dot"></span>${g.label}</span><ul>${g.players.map((p) => { const partner = partnerOf(m, p.id); return html`<li key=${p.id}>${p.name}${partner ? html`<small class="vb-pair"><${Icon} name="swap" size=${12} />${q.name(partner)}</small>` : null}</li>`; })}</ul></div>`)}</div>
          </section>
        </div>
        </div>
      </div>
    </div>`;
  }

  root.StatorPrep = { Court, LineupView, LineupEditor, LineupCard, ConsignesCard, ConsignesEditor, ConsignesView, Upcoming, hasPrep, warmup, roleLabel };
})(window);
