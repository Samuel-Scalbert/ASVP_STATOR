/* ASVP Stator — préparation d’un match par le coach : compos sur le terrain, binômes, consignes, page du match à venir.
   Une compo = les six positions de départ (P1 au service) et le libéro, qui remplace un joueur quand celui-ci
   est à l’arrière. Les rotations s’affichent à partir de là, rien d’autre n’est stocké. */
(function (root) {
  "use strict";
  const { html, useState, useEffect } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, cx, plural, fmtDate, fmtTime } = U;

  /* ---------- Modèle ---------- */
  const POS = [1, 2, 3, 4, 5, 6];
  const BACK = new Set([1, 5, 6]);
  const ROLE_ORDER = ["passeur", "pointu", "r4", "central", "libero"];
  const roleLabel = (k) => { const r = C.ROLES.find((x) => x.k === k); return r ? r.label : ""; };
  const posteOf = (id) => { const p = q.roster().find((x) => x.id === id); return (p && p.poste) || ""; };
  const emptyLineup = (n) => ({ label: "Compo " + n, positions: {}, libero: "" });
  /* Joueurs à placer : ceux du match (ou tout l’effectif actif), groupés par poste dans l’ordre du jeu. */
  function groupedSquad(matchId) {
    const ps = q.playersOf(matchId).map((p) => ({ id: p.id, name: p.name, poste: posteOf(p.id) }));
    const groups = ROLE_ORDER.concat([""]).map((k) => ({ k, label: k ? roleLabel(k) : "Sans poste", players: ps.filter((p) => p.poste === k) }))
      .filter((g) => g.players.length);
    return { all: ps, groups };
  }
  /* Qui le libéro remplace : réglage du coach, sinon les centraux placés sur le terrain. */
  function liberoTargets(lu) {
    if (Array.isArray(lu.liberoFor)) return lu.liberoFor;
    return POS.map((p) => lu.positions[p]).filter((id) => id && posteOf(id) === "central").slice(0, 2);
  }
  /* Positions après k rotations (dans le sens des aiguilles d’une montre : P2 → P1 → P6 → …). */
  function rotated(lu, k) {
    const out = {};
    POS.forEach((p) => { out[p] = lu.positions[((p - 1 + k) % 6) + 1] || ""; });
    return out;
  }
  /* Vue d’une rotation : qui est à chaque position, et où en est le libéro. */
  function rotationView(lu, k) {
    const pos = rotated(lu, k), targets = liberoTargets(lu);
    let liberoAt = 0, serving = "";
    POS.forEach((p) => { if (BACK.has(p) && p !== 1 && targets.includes(pos[p]) && lu.libero) liberoAt = p; });
    if (!liberoAt && targets.includes(pos[1]) && lu.libero) serving = pos[1]; // au service : le libéro entre après
    const cells = POS.map((p) => ({ p, id: p === liberoAt ? lu.libero : pos[p], replaced: p === liberoAt ? pos[p] : "", server: p === 1, waitsLibero: p === 1 && !!serving }));
    return { cells, liberoIn: !!liberoAt, liberoAt, out: liberoAt ? pos[liberoAt] : "" };
  }
  const partnerOf = (id) => { const pr = (q.pairs() || []).find((x) => x.includes(id)); return pr ? pr.find((x) => x !== id) : ""; };
  /* Remplaçants : les joueurs du match qui ne sont ni sur le terrain ni libéro, avec leur binôme s’il joue. */
  function bench(lu, matchId) {
    const on = new Set(POS.map((p) => lu.positions[p]).concat([lu.libero]).filter(Boolean));
    return groupedSquad(matchId).all.filter((p) => !on.has(p.id)).map((p) => {
      const partner = partnerOf(p.id);
      return Object.assign({}, p, { partner: partner && on.has(partner) ? partner : "" });
    });
  }

  /* ---------- Terrain ---------- */
  function PlayerTag({ id, libero, small }) {
    const poste = libero ? "libero" : posteOf(id);
    return html`<span class=${cx("vb-player", small && "small")}><b>${q.name(id)}</b>${poste ? html`<small class=${"role-" + poste}>${roleLabel(poste)}</small>` : null}</span>`;
  }
  /* Le terrain vu de notre fond : filet en haut, P4-P3-P2 devant, P5-P6-P1 derrière, P1 au service. */
  function Court({ lu, rotation, editor, selected, onPick, matchId }) {
    const view = rotationView(lu, rotation || 0);
    const grouped = editor ? groupedSquad(matchId) : null;
    const cellsByPos = {}; view.cells.forEach((c) => { cellsByPos[c.p] = c; });
    const cell = (p) => {
      const c = cellsByPos[p], isLib = c.replaced !== "";
      if (editor) {
        const taken = new Set(POS.filter((x) => x !== p).map((x) => lu.positions[x]).concat([lu.libero]).filter(Boolean));
        return html`<label class=${cx("vb-pos", "edit", lu.positions[p] && "set", selected === p && "sel")} key=${p}>
          <span class="vb-num">P${p}${p === 1 ? html` <${Icon} name="ball" size=${12} />` : null}</span>
          <select value=${lu.positions[p] || ""} aria-label=${"Joueur en position " + p} onChange=${(e) => onPick(p, e.target.value)}>
            <option value="">— libre —</option>
            ${grouped.groups.map((g) => html`<optgroup key=${g.k} label=${g.label}>${g.players.map((x) => html`<option key=${x.id} value=${x.id} disabled=${taken.has(x.id)}>${x.name}${taken.has(x.id) ? " (déjà placé)" : ""}</option>`)}</optgroup>`)}
          </select>
          ${lu.positions[p] ? html`<small class=${"vb-role role-" + posteOf(lu.positions[p])}>${roleLabel(posteOf(lu.positions[p])) || "poste ?"}</small>` : html`<small class="vb-role muted">à placer</small>`}
        </label>`;
      }
      return html`<div class=${cx("vb-pos", isLib && "lib", c.waitsLibero && "wait", !c.id && "empty")} key=${p}>
        <span class="vb-num">P${p}${c.server ? html` <${Icon} name="ball" size=${12} /><i>service</i>` : null}</span>
        ${c.id ? html`<${PlayerTag} id=${c.id} libero=${isLib} />` : html`<span class="vb-player muted"><b>—</b></span>`}
        ${isLib ? html`<small class="vb-note">à la place de ${q.name(c.replaced)}</small>` : null}
        ${c.waitsLibero ? html`<small class="vb-note">sert, puis libéro</small>` : null}
      </div>`;
    };
    return html`<div class="vb-court" role="group" aria-label=${"Terrain, rotation " + ((rotation || 0) + 1)}>
      <div class="vb-net"><span>Filet</span></div>
      <div class="vb-row front">${[4, 3, 2].map(cell)}</div>
      <div class="vb-attack"><span>ligne des 3 m</span></div>
      <div class="vb-row back">${[5, 6, 1].map(cell)}</div>
    </div>`;
  }
  /* Rotation : un sélecteur R1…R6, et le libéro dedans/dehors selon la rotation. */
  function Rotation({ lu, rotation, setRotation }) {
    const v = rotationView(lu, rotation);
    return html`<div class="vb-rot">
      <div class="vb-rot-btns" role="group" aria-label="Rotation">
        ${POS.map((k) => html`<button type="button" key=${k} class=${cx(rotation === k - 1 && "on")} aria-pressed=${rotation === k - 1} onClick=${() => setRotation(k - 1)}>R${k}</button>`)}
      </div>
      <p class="small muted">${lu.libero ? (v.liberoIn ? `Libéro ${q.name(lu.libero)} sur le terrain en P${v.liberoAt}, ${q.name(v.out)} sort.` : `Libéro ${q.name(lu.libero)} hors du terrain${liberoTargets(lu).length ? " (il remplace " + liberoTargets(lu).map(q.name).join(" et ") + " à l’arrière)" : ""}.`) : "Pas de libéro dans cette compo."}
        ${" "}P1 sert ; on tourne dans le sens des aiguilles d’une montre quand on récupère le service.</p>
    </div>`;
  }
  function Bench({ lu, matchId }) {
    const list = bench(lu, matchId);
    if (!list.length) return null;
    return html`<div class="vb-bench">
      <span class="eyebrow">Remplaçants</span>
      <ul>${list.map((p) => html`<li key=${p.id}><${PlayerTag} id=${p.id} small />${p.partner ? html`<span class="vb-pair" title="Binôme"><${Icon} name="swap" size=${13} />binôme de ${q.name(p.partner)}</span>` : null}</li>`)}</ul>
    </div>`;
  }
  /* Une compo en lecture : terrain, rotations, remplaçants. */
  function LineupView({ lu, matchId }) {
    const [rotation, setRotation] = useState(0);
    return html`<div class="vb-view">
      <${Court} lu=${lu} rotation=${rotation} />
      <div class="vb-aside">
        <${Rotation} lu=${lu} rotation=${rotation} setRotation=${setRotation} />
        <${Bench} lu=${lu} matchId=${matchId} />
      </div>
    </div>`;
  }

  /* ---------- Éditeur des compos (fenêtre) ---------- */
  function LineupEditor({ m, onDone }) {
    const [lineups, setLineups] = useState(() => (m.lineups && m.lineups.length ? C.clone(m.lineups) : [emptyLineup(1)]));
    const [cur, setCur] = useState(0);
    const [rotation, setRotation] = useState(0);
    const lu = lineups[cur];
    const grouped = groupedSquad(m.id);
    const update = (patch) => setLineups(lineups.map((x, i) => (i === cur ? Object.assign({}, x, patch) : x)));
    const pick = (p, id) => {
      const positions = Object.assign({}, lu.positions);
      if (id) positions[p] = id; else delete positions[p];
      const patch = { positions };
      if (Array.isArray(lu.liberoFor)) patch.liberoFor = lu.liberoFor.filter((x) => Object.values(positions).includes(x));
      update(patch);
    };
    const placed = POS.map((p) => lu.positions[p]).filter(Boolean);
    const targets = liberoTargets(lu);
    const toggleTarget = (id) => {
      const next = targets.includes(id) ? targets.filter((x) => x !== id) : targets.concat([id]).slice(-2);
      update({ liberoFor: next });
    };
    const add = () => { if (lineups.length < 4) { setLineups(lineups.concat([emptyLineup(lineups.length + 1)])); setCur(lineups.length); } };
    const remove = () => { const next = lineups.filter((_, i) => i !== cur); setLineups(next.length ? next : [emptyLineup(1)]); setCur(0); };
    const copyPrevious = () => {
      const prev = q.matchList().find((x) => x.id !== m.id && x.lineups && x.lineups.length);
      if (prev) update({ positions: C.clone(prev.lineups[0].positions), libero: prev.lineups[0].libero, liberoFor: prev.lineups[0].liberoFor });
      else U.toast("Aucune compo sur un autre match.");
    };
    const save = () => {
      const clean = lineups.map((x) => ({ label: (x.label || "").trim() || "Compo", positions: x.positions, libero: x.libero || "", ...(Array.isArray(x.liberoFor) ? { liberoFor: x.liberoFor } : {}) }))
        .filter((x) => Object.keys(x.positions).length || x.libero);
      api.saveMatch(Object.assign({}, store.matches[m.id] || m, { lineups: clean, updatedAt: new Date().toISOString() }));
      onDone(clean.length);
    };
    const liberos = grouped.all.filter((p) => !placed.includes(p.id));
    return html`<div class="lineup-editor">
      <div class="lu-tabs" role="tablist">
        ${lineups.map((x, i) => html`<button type="button" key=${i} role="tab" aria-selected=${i === cur} class=${cx("lu-tab", i === cur && "on")} onClick=${() => setCur(i)}>${x.label || "Compo " + (i + 1)}</button>`)}
        ${lineups.length < 4 && html`<button type="button" class="lu-tab add" onClick=${add} aria-label="Ajouter une compo"><${Icon} name="plus" size=${14} />Compo</button>`}
      </div>
      <div class="field-row">
        <div class="field"><label for="lu-label"><b>Nom de la compo</b><small>ex. Set 1, Si Kévin absent</small></label><input id="lu-label" value=${lu.label || ""} maxlength="40" onInput=${(e) => update({ label: e.target.value })} /></div>
        <div class="field"><span class="lbl"><b>Raccourcis</b></span><div class="row-btns">
          <button type="button" class="btn ghost sm" onClick=${copyPrevious}>Reprendre la dernière compo</button>
          <button type="button" class="btn ghost sm" onClick=${() => update({ positions: {}, libero: "", liberoFor: undefined })}>Vider</button>
        </div></div>
      </div>
      <p class="muted small">Place les six de départ : <b>P1 sert</b>, P2-P3-P4 sont au filet, P5-P6 à l’arrière. Les listes sont rangées par poste.</p>
      <${Court} lu=${lu} rotation=${0} editor matchId=${m.id} onPick=${pick} />
      <div class="field-row">
        <div class="field"><label for="lu-libero"><b>Libéro</b></label>
          <select id="lu-libero" value=${lu.libero || ""} onChange=${(e) => update({ libero: e.target.value })}>
            <option value="">— aucun —</option>
            ${liberos.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}${p.poste ? " · " + roleLabel(p.poste) : ""}</option>`)}
          </select></div>
        <div class="field"><span class="lbl"><b>Il remplace à l’arrière</b><small>deux joueurs au plus</small></span>
          <div class="chips">${placed.length ? placed.map((id) => html`<button type="button" key=${id} class=${cx("chip", targets.includes(id) && "done")} aria-pressed=${targets.includes(id)} disabled=${!lu.libero} onClick=${() => toggleTarget(id)}>${targets.includes(id) && html`<${Icon} name="check" size=${13} />`}${q.name(id)}</button>`) : html`<span class="muted small">Place d’abord les joueurs.</span>`}</div></div>
      </div>
      <details class="lu-preview"><summary>Aperçu des rotations et des remplaçants</summary>
        <${Court} lu=${lu} rotation=${rotation} />
        <${Rotation} lu=${lu} rotation=${rotation} setRotation=${setRotation} />
        <${Bench} lu=${lu} matchId=${m.id} />
      </details>
      <div class="row-btns end">
        ${lineups.length > 1 || placed.length ? html`<button type="button" class="btn ghost" onClick=${remove}><${Icon} name="trash" size=${16} />Supprimer cette compo</button>` : null}
        <button type="button" class="btn primary" onClick=${save}><${Icon} name="check" size=${18} />Enregistrer</button>
      </div>
    </div>`;
  }

  /* ---------- Consignes du coach ---------- */
  /* Texte libre : chaque ligne « - … » devient une puce (listes consécutives regroupées), le reste des paragraphes. */
  function NoteText({ text }) {
    const blocks = [];
    (text || "").split("\n").forEach((raw) => {
      const line = raw.trim(), last = blocks[blocks.length - 1];
      if (!line) { if (last) last.closed = true; return; }
      const m = line.match(/^[-•*]\s*(.*)$/);
      if (m) { if (last && last.list && !last.closed) last.list.push(m[1]); else blocks.push({ list: [m[1]] }); }
      else if (last && last.text && !last.closed) last.text += " " + line;
      else blocks.push({ text: line });
    });
    return html`<div class="note-text">${blocks.map((b, i) => (b.list ? html`<ul key=${i}>${b.list.map((l, j) => html`<li key=${j}>${l}</li>`)}</ul>` : html`<p key=${i}>${b.text}</p>`))}</div>`;
  }
  function NoteEditor({ m, onDone }) {
    const [text, setText] = useState(m.note || "");
    const save = () => { api.saveMatch(Object.assign({}, store.matches[m.id] || m, { note: text.trim(), updatedAt: new Date().toISOString() })); onDone(); };
    return html`<div class="note-editor">
      <p class="muted small">Une consigne par ligne, en commençant par « - » pour une liste. Elles s’affichent sur la fiche du match, pour toute l’équipe.</p>
      <textarea id="note-text" rows="10" value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${"- Service long sur le passeur\n- Bloc fermé sur leur pointu\n- On parle en défense"} maxlength="4000"></textarea>
      ${text.trim() ? html`<div class="note-preview"><span class="eyebrow">Aperçu</span><${NoteText} text=${text} /></div>` : null}
      <div class="row-btns end"><button type="button" class="btn primary" onClick=${save}><${Icon} name="check" size=${18} />Enregistrer</button></div>
    </div>`;
  }

  /* ---------- Cartes « Préparation » (compo + consignes), sur la page d’un match ---------- */
  function LineupCard({ m, openSheet, compact }) {
    const lineups = m.lineups || [];
    const [cur, setCur] = useState(0);
    const lu = lineups[Math.min(cur, lineups.length - 1)];
    const edit = !store.readOnly && html`<button class="btn ghost sm" onClick=${() => openSheet({ type: "lineup", m })}><${Icon} name="edit" size=${16} />${lineups.length ? "Modifier" : "Faire la compo"}</button>`;
    return html`<section class="card prep-card">
      <div class="block-head"><h2 class="h-sec">Compo du coach</h2>${edit}</div>
      ${lineups.length ? html`
        ${lineups.length > 1 && html`<div class="lu-tabs" role="tablist">${lineups.map((x, i) => html`<button type="button" key=${i} role="tab" aria-selected=${i === cur} class=${cx("lu-tab", i === cur && "on")} onClick=${() => setCur(i)}>${x.label || "Compo " + (i + 1)}</button>`)}</div>`}
        ${lineups.length === 1 && lu.label && !/^Compo( \d+)?$/.test(lu.label) ? html`<span class="eyebrow">${lu.label}</span>` : null}
        <${LineupView} lu=${lu} matchId=${m.id} key=${cur} />`
        : html`<p class="muted">${compact ? "Pas de compo enregistrée pour ce match." : "Le coach n’a pas encore annoncé sa compo. Les six de départ et le libéro s’afficheront ici, sur le terrain, avec les rotations."}</p>`}
    </section>`;
  }
  function NoteCard({ m, openSheet }) {
    const edit = !store.readOnly && html`<button class="btn ghost sm" onClick=${() => openSheet({ type: "note", m })}><${Icon} name="edit" size=${16} />${m.note ? "Modifier" : "Écrire"}</button>`;
    return html`<section class="card prep-card">
      <div class="block-head"><h2 class="h-sec">Consignes du coach</h2>${edit}</div>
      ${m.note ? html`<${NoteText} text=${m.note} />` : html`<p class="muted">Pas encore de consignes. Le coach peut noter ici le plan de jeu : service, réception, bloc, défense…</p>`}
    </section>`;
  }
  const hasPrep = (m) => !!((m.lineups && m.lineups.length) || m.note);

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
    const groups = ROLE_ORDER.concat([""]).map((r) => ({ r, label: r ? roleLabel(r) : "Sans poste", ps: players.filter((p) => posteOf(p.id) === r) })).filter((g) => g.ps.length);
    const gym = info && info.gym;
    return html`<div>
      <section class="match-band upcoming-band">
        <div class="match-band-in">
          <button class="icon-btn on-band" onClick=${() => go({ view: "home" })} aria-label="Retour aux matchs"><${Icon} name="back" /></button>
          <div class="mb-main">
            <span class="eyebrow on-band">Match à venir · ${k === 0 ? "aujourd’hui" : k === 1 ? "demain" : "J-" + k}${m.competition ? " · " + m.competition : ""}</span>
            <div class="board sm"><span class="board-team">ASVP</span><span class="board-vs">vs</span><span class="board-team opp">${m.opponent}</span></div>
            <div class="up-when">
              <span class="up-date"><${Icon} name="cal" size=${18} />${fmtDate(m.date, { weekday: "long", day: "numeric", month: "long" })}${m.time ? html` · <b>${fmtTime(m.time)}</b>` : html` · <i>heure à préciser</i>`}</span>
              <span class="up-place"><${Icon} name="pin" size=${18} />${venueLabel(m.venue) || "Lieu à préciser"}${gym ? html` · <b>${gym.name}</b>` : null}</span>
            </div>
          </div>
        </div>
        <div class="match-actions">
          ${!store.readOnly && html`<button class="btn primary sm" onClick=${() => openSheet({ type: "lineup", m })}><${Icon} name="grid" size=${16} />${m.lineups && m.lineups.length ? "Modifier la compo" : "Faire la compo"}</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "note", m })}><${Icon} name="edit" size=${16} />${m.note ? "Modifier les consignes" : "Écrire les consignes"}</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "match-form", m })}><${Icon} name="edit" size=${16} />Date, lieu, joueurs</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "delete", m })} aria-label="Supprimer le match"><${Icon} name="trash" size=${16} /></button>`}
        </div>
      </section>
      <div class="page wide"><div class="summary-grid">
        <div class="col">
          <section class="card up-info">
            <h2 class="h-sec">Infos pratiques</h2>
            <dl class="up-facts">
              <div><dt>Quand</dt><dd><b>${fmtDate(m.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>${m.time ? html`, ${fmtTime(m.time)}` : html`, <span class="warn">heure à préciser</span>`}</dd></div>
              <div><dt>Où</dt><dd>${gym ? html`<b>${gym.name}</b>${gym.address ? html`<br />${gym.address}` : null}<br /><a class="btn ghost sm up-maps" href=${gym.maps} target="_blank" rel="noopener noreferrer"><${Icon} name="pin" size=${15} />Itinéraire</a>` : html`${venueLabel(m.venue) || html`<span class="warn">Lieu à préciser</span>`}${m.venue === "ext" ? html` <span class="muted">· salle à confirmer</span>` : null}`}</dd></div>
              ${info && (info.ourColors || info.theirColors) ? html`<div><dt>Maillots</dt><dd>ASVP <b>${(info.ourColors || "?").toLowerCase()}</b> · ${m.opponent} <b>${(info.theirColors || "?").toLowerCase()}</b>${info.ourColors && info.theirColors && /bleu/i.test(info.ourColors) && /bleu/i.test(info.theirColors) ? html` <span class="warn">— couleurs proches, prévoir le second jeu</span>` : null}</dd></div>` : null}
              ${info && info.code ? html`<div><dt>Championnat</dt><dd>${info.title} · match ${info.code}${info.round ? ", journée " + info.round : ""}</dd></div>` : null}
            </dl>
          </section>
          <${LineupCard} m=${m} openSheet=${openSheet} />
          <${NoteCard} m=${m} openSheet=${openSheet} />
        </div>
        <div class="col">
          ${info && info.rank ? html`<section class="card up-opp">
            <div class="block-head"><h2 class="h-sec">L’adversaire</h2><span class="rank-chip">${LG.ordinal(info.rank)} sur ${info.teams}</span></div>
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
            <div class="up-squad">${groups.map((g) => html`<div key=${g.r}><span class="eyebrow">${g.label}</span><ul>${g.ps.map((p) => { const partner = partnerOf(p.id); return html`<li key=${p.id}>${p.name}${partner && players.some((x) => x.id === partner) ? html`<small class="vb-pair"><${Icon} name="swap" size=${12} />${q.name(partner)}</small>` : null}</li>`; })}</ul></div>`)}</div>
          </section>
        </div>
      </div></div>
    </div>`;
  }

  root.StatorPrep = { Court, LineupView, LineupEditor, LineupCard, NoteCard, NoteEditor, NoteText, Upcoming, hasPrep, rotationView, liberoTargets };
})(window);
