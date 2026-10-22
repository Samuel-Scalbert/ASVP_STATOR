/* ASVP Stator — accueil, vue d’un match, formulaires. */
(function (root) {
  "use strict";
  const { html, useState } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q, lsGet, lsSet } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, RateChip, Meter, Recap, LevelLegend, DiffBar, cx, pct, signed, plural, fmtDate, shortDate } = U;

  const venueLabel = (v) => (v === "dom" ? "Domicile" : v === "ext" ? "Extérieur" : "");
  function ResultChip({ m }) {
    const r = C.matchResult(m);
    if (!r) return html`<span class="res none">Score à saisir</span>`;
    const k = r.a > r.o ? "win" : r.a < r.o ? "loss" : "draw";
    return html`<span class=${"res " + k}>${k === "win" ? "Victoire" : k === "loss" ? "Défaite" : "Nul"} ${r.a}–${r.o}</span>`;
  }
  /* Nombre de sets à afficher : ceux du score, ou le dernier set où quelqu’un a des stats. */
  function playedSets(m, allSets) {
    let n = C.matchSetCount(m);
    allSets.forEach((sets) => sets.forEach((set, i) => { if (C.countActions(set)) n = Math.max(n, i + 1); }));
    return n;
  }
  function completion(matchId) {
    const ps = q.playersOf(matchId);
    return { done: ps.filter((p) => C.isFilled(p.doc)).length, total: ps.length, ps };
  }

  /* ---------- Choix du joueur ---------- */
  function WhoGrid({ me, onPick }) {
    const list = q.active();
    if (!list.length) return html`<p class="muted">L’effectif est vide. Ajoute les joueurs dans l’onglet Équipe.</p>`;
    return html`<div class="who-grid">
      ${list.map((p) => html`<button key=${p.id} class=${cx("who", p.id === me && "on")} onClick=${() => onPick(p.id)}>${p.name}${q.posteLabel(p.id) ? html`<small>${q.posteLabel(p.id)}</small>` : null}</button>`)}
    </div>`;
  }

  /* ---------- Accueil ---------- */
  function Steps({ onClose }) {
    return html`<section class="steps card">
      <div class="steps-head"><h2 class="h-sec">Comment ça marche</h2>
        <button class="icon-btn" onClick=${onClose} aria-label="Masquer l’explication"><${Icon} name="x" size=${18} /></button></div>
      <ol>
        <li><b>Ouvre le match.</b> Le dernier est en haut. S’il n’existe pas encore, crée-le dans l’onglet « Nouveau match ».</li>
        <li><b>Compte tes actions, set par set.</b> Une touche par action. Chaque case est expliquée.</li>
        <li><b>Écris ton bilan.</b> Deux lignes perso, deux lignes collectif. Totaux et taux se calculent seuls.</li>
      </ol>
    </section>`;
  }
  function MatchHero({ m, me, go }) {
    const comp = completion(m.id);
    const mine = me ? q.doc(m.id, me) : null;
    const state = !me ? null : !mine || !C.isFilled(mine) ? "à faire" : C.hasBilan(mine) ? "complète" : "bilan à écrire";
    const sets = C.matchSets(m);
    const r = C.matchResult(m);
    return html`<section class="hero">
      <div class="hero-top">
        <span class="eyebrow on-band">Dernier match · ${fmtDate(m.date)}${venueLabel(m.venue) ? " · " + venueLabel(m.venue) : ""}</span>
        ${m.competition && html`<span class="eyebrow on-band">${m.competition}</span>`}
      </div>
      <div class="board">
        <span class="board-team">ASVP</span>
        <span class="board-score">${r ? r.a : "–"}<i>–</i>${r ? r.o : "–"}</span>
        <span class="board-team opp">${m.opponent}</span>
      </div>
      <div class="board-sets">${sets.length ? sets.map((s, i) => html`<span key=${i}>${s.a}–${s.o}</span>`) : html`<span class="muted-band">Score des sets non renseigné</span>`}</div>
      <div class="hero-foot">
        <div class="hero-state">
          ${m.noData
            ? html`<span><${NoDataBadge} /> Pas de vidéo : seul le score est enregistré.</span>`
            : m.closed ? html`<span><${ClosedBadge} band /> ${U.plural(comp.done, "fiche remplie", "fiches remplies")}</span>`
            : html`${state && html`<span>Ta fiche : <b>${state}</b></span>`}<span>${comp.done}/${comp.total} joueurs ont saisi</span>`}
        </div>
        <div class="hero-actions">
          ${!store.readOnly && !m.noData && !m.closed && html`<button class="btn primary" onClick=${() => go({ view: "entry", matchId: m.id })}>${state === "à faire" || !state ? "Saisir mes stats" : "Reprendre ma fiche"}</button>`}
          <button class="btn on-band-ghost" onClick=${() => go({ view: "match", matchId: m.id })}>Voir le match</button>
        </div>
      </div>
    </section>`;
  }
  function Home({ me, go, openSheet }) {
    const [stepsOff, setStepsOff] = useState(() => lsGet("asvp-stator-steps", false));
    const list = q.matchList();
    if (!q.roster().length) {
      return html`<div class="page">
        <section class="card onboard">
          <h1 class="h-page">Bienvenue sur ASVP Stator</h1>
          <p>Les stats de match de l’équipe, saisies en quelques minutes sur téléphone, sans tableur. Pour commencer, ajoute l’effectif ou importe un fichier Excel de match : les joueurs seront repris automatiquement.</p>
          <div class="row-btns">
            <button class="btn primary" onClick=${() => openSheet({ type: "import" })}><${Icon} name="up" size=${18} />Importer un Excel de match</button>
            <button class="btn ghost" onClick=${() => go({ view: "team" })}>Saisir l’effectif</button>
          </div>
        </section>
      </div>`;
    }
    return html`<div class="page wide"><div class="home-grid"><div class="home-main">
      ${!me && html`<section class="card who-card">
        <h2 class="h-sec">Qui es-tu ?</h2>
        <p class="muted">Ton nom sert à ouvrir ta fiche. Il reste mémorisé sur cet appareil.</p>
        <${WhoGrid} me=${me} onPick=${(id) => openSheet({ type: "who-picked", id })} />
      </section>`}
      ${!stepsOff && html`<${Steps} onClose=${() => { setStepsOff(true); lsSet("asvp-stator-steps", true); }} />`}
      ${list.length ? html`<${MatchHero} m=${list[0]} me=${me} go=${go} />` : html`<section class="card empty-state">
        <h2 class="h-sec">Aucun match pour l’instant</h2>
        <p>Crée le prochain match, ou importe un ancien fichier Excel pour retrouver la saison.</p>
      </section>`}
      </div>
      <section class="block match-block">
        <div class="block-head">
          <h2 class="h-sec">Tous les matchs</h2>
          <div class="row-btns">
            ${!store.readOnly && html`<button class="btn ghost sm" onClick=${() => openSheet({ type: "import" })}><${Icon} name="up" size=${16} />Importer</button>`}
            ${!store.readOnly && html`<button class="btn dark sm" onClick=${() => go({ view: "newmatch" })}><${Icon} name="plus" size=${16} />Nouveau match</button>`}
          </div>
        </div>
        <ul class="match-list">
          ${list.map((m) => {
            const comp = completion(m.id);
            return html`<li key=${m.id}><button class="match-row" onClick=${() => go({ view: "match", matchId: m.id })}>
              <span class="mr-date">${m.date ? shortDate(m.date) : "Date ?"}</span>
              <span class="mr-main"><b>${m.opponent}</b><small>${[venueLabel(m.venue), m.competition].filter(Boolean).join(" · ") || "Match"}</small></span>
              <${ResultChip} m=${m} />
              ${m.noData ? html`<${NoDataBadge} sm />` : m.closed ? html`<span class="mr-comp" title="Saisie close">Close</span>` : html`<span class="mr-comp" title="Joueurs ayant saisi">${comp.done}/${comp.total}</span>`}
              <${Icon} name="next" size=${18} />
            </button></li>`;
          })}
        </ul>
      </section>
    </div></div>`;
  }

  /* ---------- Formulaire de match (création et modification) ---------- */
  function MatchForm({ m, preset, onDone }) {
    const editing = !!m;
    const p = preset || {};
    const roster = q.roster();
    const activeIds = q.active().map((x) => x.id);
    const past = q.matchList().filter((x) => !m || x.id !== m.id);
    const lastSquad = past.length && Array.isArray(past[0].squad) && past[0].squad.length ? past[0].squad : null;
    const [opp, setOpp] = useState(m ? m.opponent : p.opponent || "");
    const [date, setDate] = useState(m ? m.date || "" : new Date().toISOString().slice(0, 10));
    const [venue, setVenue] = useState(m ? m.venue || "" : p.venue != null ? p.venue : "dom");
    const [comp, setComp] = useState(m ? m.competition || "" : p.competition || "Départementale");
    const [video, setVideo] = useState(m ? m.video || "" : "");
    const [videoKind, setVideoKind] = useState(m ? m.videoKind || (m.video ? "lien" : "") : "");
    const [videoNote, setVideoNote] = useState(m ? m.videoNote || "" : "");
    const [noData, setNoData] = useState(m ? !!m.noData : !!p.noData);
    const [squad, setSquad] = useState(() => (m && Array.isArray(m.squad) && m.squad.length ? m.squad.slice() : activeIds));
    const init = C.matchSets(m || {});
    const [rows, setRows] = useState(() => [0, 1, 2, 3, 4].map((i) => (init[i] ? { a: String(init[i].a), o: String(init[i].o) } : { a: "", o: "" })));
    const r0 = m && m.result ? m.result : null;
    const [ra, setRa] = useState(r0 ? String(r0.a) : "");
    const [ro, setRo] = useState(r0 ? String(r0.o) : "");
    const [err, setErr] = useState("");
    const sets = rows.map((x) => ({ a: parseInt(x.a, 10), o: parseInt(x.o, 10) })).filter((x) => Number.isFinite(x.a) && Number.isFinite(x.o));
    const fromSets = sets.length ? C.matchResult({ sets }) : null;
    // Joueurs proposés : l’effectif actif, plus ceux d’un ancien match qui ont été retirés depuis.
    const choices = roster.filter((x) => x.active !== false || squad.indexOf(x.id) >= 0);
    const uniq = (arr) => arr.filter((v, i) => v && arr.findIndex((w) => C.norm(w) === C.norm(v)) === i);
    const opponents = uniq(past.map((x) => x.opponent));
    // L’équipe ne joue que deux sortes de matchs : départementale (domicile ou extérieur) et amical.
    const TYPES = [["Départementale", "Match départemental", "À domicile ou à l’extérieur"], ["Amical", "Match amical", "Hors championnat"]];
    const isType = (k) => C.norm(comp) === C.norm(k);
    const toggle = (id) => setSquad(squad.indexOf(id) >= 0 ? squad.filter((x) => x !== id) : squad.concat([id]));
    const submit = (e) => {
      e.preventDefault();
      if (!opp.trim()) { setErr("Indique le nom de l’adversaire."); return; }
      const res = fromSets ? null : (Number.isFinite(parseInt(ra, 10)) && Number.isFinite(parseInt(ro, 10)) ? { a: parseInt(ra, 10), o: parseInt(ro, 10) } : null);
      if (noData && !sets.length && !res) { setErr("Renseigne le score : le détail des sets, ou au moins le résultat en sets."); return; }
      if (!noData && choices.length && !squad.length) { setErr("Coche au moins un joueur du match."); return; }
      if (!noData && videoKind === "lien" && !/^https?:\/\//i.test(video.trim())) { setErr("Colle le lien complet de la vidéo, qui commence par https://"); return; }
      const order = roster.map((x) => x.id);
      const doc = Object.assign({}, m || { id: C.uid("m-"), createdAt: new Date().toISOString() }, {
        opponent: opp.trim(), date, venue, competition: comp.trim(), sets, result: res, noData,
        videoKind: noData ? "" : videoKind,
        video: !noData && videoKind === "lien" ? video.trim() : "",
        videoNote: !noData && videoKind === "discord" ? videoNote.trim() : "",
        squad: noData ? [] : squad.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)), updatedAt: new Date().toISOString(),
      });
      api.saveMatch(doc);
      onDone(doc, !editing);
    };
    const setRow = (i, k, v) => setRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { [k]: v.replace(/[^0-9]/g, "").slice(0, 2) }) : x)));
    const scoreFields = html`
      <div class="sets-grid">
        <span></span><span class="sg-h">ASVP</span><span class="sg-h">${opp.trim() || "Adv."}</span>
        ${rows.map((x, i) => html`<span class="sg-l" key=${"l" + i}>Set ${i + 1}</span>
          <input key=${"a" + i} id=${"f-s" + i + "a"} inputmode="numeric" aria-label=${"Set " + (i + 1) + " ASVP"} value=${x.a} onInput=${(e) => setRow(i, "a", e.target.value)} />
          <input key=${"o" + i} id=${"f-s" + i + "o"} inputmode="numeric" aria-label=${"Set " + (i + 1) + " adversaire"} value=${x.o} onInput=${(e) => setRow(i, "o", e.target.value)} />`)}
      </div>
      ${fromSets ? html`<p class="muted">Résultat calculé : ASVP ${fromSets.a}–${fromSets.o}</p>` : html`
        <div class="field"><span class="lbl"><b>Résultat en sets</b><small>Si tu n’as pas le détail des sets</small></span>
          <div class="res-inputs">
            <span>ASVP</span><input id="f-ra" inputmode="numeric" aria-label="Sets gagnés par ASVP" value=${ra} onInput=${(e) => setRa(e.target.value.replace(/[^0-3]/g, "").slice(0, 1))} />
            <span>–</span><input id="f-ro" inputmode="numeric" aria-label="Sets gagnés par l’adversaire" value=${ro} onInput=${(e) => setRo(e.target.value.replace(/[^0-3]/g, "").slice(0, 1))} /><span>${opp.trim() || "Adv."}</span>
          </div></div>`}`;
    return html`<form class="form" onSubmit=${submit}>
      <div class="field"><span class="lbl"><b>Type de match</b></span>
        <div class="type-pick" role="radiogroup" aria-label="Type de match">
          ${TYPES.map(([k, l, sub]) => html`<button type="button" key=${k} role="radio" aria-checked=${isType(k)} class=${cx("tpl", isType(k) && "on")} onClick=${() => setComp(k)}><b>${l}</b><small>${sub}</small></button>`)}
        </div>
        ${comp && !TYPES.some(([k]) => isType(k)) ? html`<small class="muted">Type enregistré : ${comp}. Choisis l’un des deux pour le remplacer.</small>` : null}
      </div>
      <div class="field"><label for="f-opp"><b>Adversaire</b></label>
        <input id="f-opp" data-autofocus list="f-opp-list" value=${opp} onInput=${(e) => { setOpp(e.target.value); setErr(""); }} placeholder="Nom du club adverse" autocomplete="off" />
        <datalist id="f-opp-list">${opponents.map((o) => html`<option key=${o} value=${o}></option>`)}</datalist></div>
      <div class="field-row">
        <div class="field"><label for="f-date"><b>Date</b></label><input id="f-date" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /></div>
        <div class="field"><span class="lbl"><b>Lieu</b></span>
          <div class="seg-ctl" role="group" aria-label="Lieu">
            ${[["dom", "Domicile"], ["ext", "Extérieur"]].map(([k, l]) => html`<button type="button" key=${k} class=${venue === k ? "on" : ""} aria-pressed=${venue === k} onClick=${() => setVenue(venue === k ? "" : k)}>${l}</button>`)}
          </div></div>
      </div>
      <label class=${cx("nodata-toggle", noData && "on")} for="f-nodata">
        <input id="f-nodata" type="checkbox" checked=${noData} onChange=${(e) => { setNoData(e.target.checked); setErr(""); }} />
        <span><b>Pas de vidéo : score seulement</b>
          <small>Le match sera marqué <span class="nodata-badge sm">NO VIDEO / NO DATA</span> : on enregistre le score, sans fiches à remplir. Si la vidéo arrive plus tard, il suffira de décocher.</small></span>
      </label>
      ${noData ? null : choices.length ? html`<fieldset class="field">
        <legend><b>Joueurs du match</b><small>${squad.length} sur ${choices.length} · ce sont eux qui remplissent une fiche</small></legend>
        <div class="row-btns">
          <button type="button" class="btn ghost sm" onClick=${() => setSquad(activeIds)}>Tout l’effectif</button>
          ${lastSquad && html`<button type="button" class="btn ghost sm" onClick=${() => setSquad(lastSquad.slice())}>Comme au dernier match</button>`}
          <button type="button" class="btn ghost sm" onClick=${() => setSquad([])}>Personne</button>
        </div>
        <div class="squad-grid">
          ${choices.map((x) => { const on = squad.indexOf(x.id) >= 0; return html`<button type="button" key=${x.id} class=${cx("squad-chip", on && "on")} aria-pressed=${on} onClick=${() => { toggle(x.id); setErr(""); }}>
            <span class="squad-box" aria-hidden="true">${on ? html`<${Icon} name="check" size=${14} />` : null}</span>
            <span class="squad-name">${x.name}${q.posteLabel(x.id) ? html`<small>${q.posteLabel(x.id)}</small>` : null}</span></button>`; })}
        </div>
      </fieldset>` : html`<p class="muted small">L’effectif est vide : ajoute les joueurs dans l’onglet Équipe pour choisir qui joue ce match.</p>`}
      ${!noData && html`<fieldset class="field"><legend><b>Vidéo du match</b><small>Facultatif</small></legend>
        <div class="seg-ctl" role="group" aria-label="Vidéo du match">
          ${[["", "Aucune"], ["lien", "Lien YouTube"], ["discord", "Fichier sur Discord"]].map(([k, l]) => html`<button type="button" key=${k || "aucune"} class=${videoKind === k ? "on" : ""} aria-pressed=${videoKind === k} onClick=${() => { setVideoKind(k); setErr(""); }}>${l}</button>`)}
        </div>
        ${videoKind === "lien" && html`<input id="f-video" type="url" inputmode="url" aria-label="Lien de la vidéo" value=${video} onInput=${(e) => { setVideo(e.target.value); setErr(""); }} placeholder="https://youtu.be/…" autocomplete="off" />
          ${video.trim() && /^https?:\/\//i.test(video.trim()) && !U.youtubeEmbed(video) ? html`<small class="warn">Ce lien n’est pas reconnu comme une vidéo YouTube : il s’ouvrira simplement dans un nouvel onglet.</small>` : null}`}
        ${videoKind === "discord" && html`<input id="f-video-note" aria-label="Nom du fichier sur Discord" value=${videoNote} onInput=${(e) => setVideoNote(e.target.value)} placeholder="Nom du fichier (facultatif), ex. : ASVP-match.mp4" autocomplete="off" />
          <small class="muted">La vidéo est un fichier enregistré sur Discord : l’app garde seulement cette mention.</small>`}
      </fieldset>`}
      ${editing || noData || sets.length || ra || ro
        ? html`<fieldset class="field"><legend><b>Score des sets</b><small>${noData ? "Obligatoire : le détail des sets, ou au moins le résultat en sets." : "Facultatif, mais il permet de vérifier les stats saisies."}</small></legend>${scoreFields}</fieldset>`
        : html`<details class="score-later"><summary>Le match est déjà joué ? Renseigner le score</summary>
            <p class="muted small">Sinon, tu pourras l’ajouter après le match avec le bouton « Modifier ».</p>${scoreFields}</details>`}
      ${err && html`<p class="form-err" role="alert">${err}</p>`}
      <div class="row-btns end"><button class="btn primary" type="submit">${editing ? "Enregistrer le match" : "Créer le match"}</button></div>
    </form>`;
  }

  /* ---------- Onglet « Nouveau match » ---------- */
  function NewMatch({ go }) {
    if (store.readOnly) {
      return html`<div class="page"><p class="notice ro">Tu consultes l’app en lecture seule : tu ne peux pas créer de match.</p></div>`;
    }
    return html`<div class="page">
      <div class="tuto-head">
        <span class="eyebrow">Nouveau match</span>
        <h1 class="h-page">Créer un match</h1>
        <p class="lead">Match départemental ou amical : complète les infos, coche les joueurs du match, puis chacun remplit sa fiche.</p>
      </div>
      <section class="card">
        <${MatchForm} preset=${{ competition: "Départementale", venue: "dom" }}
          onDone=${(doc) => { U.toast("Match créé : ASVP – " + doc.opponent + "."); go({ view: "match", matchId: doc.id }); }} />
      </section>
    </div>`;
  }

  /* ---------- Aide d’une compétence ---------- */
  function SkillHelp({ sk }) {
    const s = C.SKILL[sk];
    const order = Object.keys(s.outcomes);
    return html`<div class="help">
      <p class="help-scope"><b>Ce qu’on compte :</b> ${s.scope}</p>
      <ul class="defs">
        ${order.map((o) => { const oc = s.outcomes[o]; return html`<li key=${o} class=${"def l" + oc.lvl}>
          <div class="def-h"><b>${oc.label}</b>${oc.pt ? html`<span class=${cx("tile-pt inline", oc.pt > 0 ? "plus" : "minus")}>${oc.pt > 0 ? "+1 point marqué" : "−1 faute"}</span>` : null}</div>
          <p>${oc.def}</p></li>`; })}
      </ul>
      ${s.hasPostes && html`<div class="help-court"><p><b>Postes :</b> on note à quel poste la passe est destinée (ou d’où part l’attaque).</p><${U.Court} /></div>`}
      <p class="help-rate"><b>Taux de transformation :</b> ${s.rateText}.</p>
    </div>`;
  }

  /* ---------- Vue d’un match ---------- */
  function Completion({ comp, me, m, go }) {
    const mine = me ? comp.ps.find((p) => p.id === me) : null;
    if (m.closed) {
      const done = comp.ps.filter((p) => C.isFilled(p.doc));
      return html`<section class="card">
        <div class="block-head"><h2 class="h-sec">Saisies</h2><${ClosedBadge} /></div>
        <p>${U.plural(done.length, "fiche remplie", "fiches remplies")} sur ${comp.total} joueurs du match. La saisie est terminée : les points non notés ne sont pas comptabilisés.</p>
        <div class="chips">${done.map((p) => html`<span key=${p.id} class="chip done"><${Icon} name="check" size=${13} />${p.name}</span>`)}</div>
      </section>`;
    }
    return html`<section class="card">
      <div class="block-head"><h2 class="h-sec">Saisies</h2><span class="muted">${comp.done} sur ${comp.total} joueurs</span></div>
      <div class="chips">
        ${comp.ps.map((p) => html`<span key=${p.id} class=${cx("chip", C.isFilled(p.doc) ? "done" : "todo")}>
          ${C.isFilled(p.doc) && html`<${Icon} name="check" size=${13} />`}${p.name}</span>`)}
      </div>
      ${me && !store.readOnly && (!mine || !C.isFilled(mine.doc)) && html`<div class="row-btns"><button class="btn primary" onClick=${() => go({ view: "entry", matchId: m.id })}>Saisir mes stats</button></div>`}
      <p class="muted small">Quand tout le monde a fini, « Clôturer la saisie » (en haut) arrête le suivi : l’écart avec le score sera compté comme points non notés.</p>
    </section>`;
  }
  function ScoreCheck({ m, perSet, openForm }) {
    const sets = C.matchSets(m);
    if (!sets.length) {
      return html`<section class="card">
        <h2 class="h-sec">Score et stats</h2>
        <p class="muted">Renseigne le score des sets pour comparer le score avec les points notés dans les fiches.</p>
        ${!store.readOnly && html`<button class="btn ghost sm" onClick=${openForm}>Renseigner le score</button>`}
      </section>`;
    }
    const closed = !!m.closed;
    const totA = sets.reduce((t, s) => t + s.a, 0), totO = sets.reduce((t, s) => t + s.o, 0);
    const missing = sets.reduce((t, s, i) => t + Math.max(0, s.a - perSet[i].P) + Math.max(0, s.o - perSet[i].F), 0);
    return html`<section class="card">
      <h2 class="h-sec">${closed ? "Points notés et non notés" : "D’où viennent les points"}</h2>
      <p class="muted small">Comparaison du score avec les points notés dans les fiches (la « vérification avec score final » de l’Excel).</p>
      <div class="score-rows">
        ${sets.map((s, i) => {
          const P = perSet[i].P, F = perSet[i].F;
          return html`<div class="score-row" key=${i}>
            <div class="sr-head"><b>Set ${i + 1}</b><span>${s.a}–${s.o}</span></div>
            <div class="stack" role="img" aria-label=${"Set " + (i + 1) + " : " + P + " points notés, " + Math.max(0, s.a - P) + " non notés"}>
              <span class="stack-a" style=${{ flexGrow: Math.min(P, s.a) }}></span><span class="stack-b" style=${{ flexGrow: Math.max(0, s.a - P) }}></span>
            </div>
            ${closed
              ? html`<div class="sr-txt"><b>ASVP ${s.a} pts</b> : ${U.plural(P, "noté", "notés")} · ${U.plural(Math.max(0, s.a - P), "non noté", "non notés")}</div>
                  <div class="sr-txt"><b>${m.opponent} ${s.o} pts</b> : ${F} sur nos fautes notées · ${U.plural(Math.max(0, s.o - F), "non noté", "non notés")}</div>`
              : html`<div class="sr-txt"><b>ASVP ${s.a} pts</b> : ${P} sur nos actions saisies, ${s.a - P} sur fautes adverses ou non saisis</div>
                  <div class="sr-txt"><b>${m.opponent} ${s.o} pts</b> : ${F} sur nos fautes saisies, ${s.o - F} sur leurs actions ou non saisis</div>`}
            ${P > s.a || F > s.o ? html`<div class="sr-txt warn">Plus de points saisis que dans le score : une fiche est à vérifier.</div>` : null}
          </div>`;
        })}
        ${sets.length > 1 ? html`<div class="score-total"><b>Total des points</b><span>ASVP ${totA} – ${totO} ${m.opponent}</span></div>` : null}
      </div>
      ${closed && html`<p class="closed-note"><b>${missing} ${missing > 1 ? "points non notés" : "point non noté"}</b> sur ${totA + totO} (moments sans vidéo, ou fautes de l’adversaire, que la fiche ne note pas). Ils ne sont pas comptabilisés dans les stats.</p>`}
      <ul class="legend"><li><span class="sw stack-a"></span>${closed ? "Points notés" : "Points sur nos actions saisies"}</li><li><span class="sw stack-b"></span>${closed ? "Points non notés (non comptabilisés)" : "Fautes adverses ou non saisis"}</li></ul>
    </section>`;
  }
  function Opponent({ allSets, nSets }) {
    const o = C.opponentLine(allSets);
    const per = Array.from({ length: nSets }, (_, i) => C.opponentLine(allSets.map((s) => [s[i]])));
    const line = (label, k) => html`<tr><th scope="row" class="left">${label}</th>${per.map((x, i) => html`<td key=${i}>${x[k]}</td>`)}<td><b>${o[k]}</b></td></tr>`;
    const row = (label, rel, att) => {
      const t = rel + att;
      return html`<div class="opp-row">
        <div class="sr-head"><b>${label}</b><span>${t ? pct(att / t) + " lui laissent une attaque" : "Aucune donnée"}</span></div>
        ${t ? html`<div class="stack" role="img" aria-label=${rel + " relances, " + att + " attaques adverses"}>
          <span class="seg l2" style=${{ flexGrow: rel }}></span><span class="seg l3" style=${{ flexGrow: att }}></span></div>` : null}
        <div class="sr-txt">${plural(rel, "relance", "relances")} · ${plural(att, "attaque adverse", "attaques adverses")}</div>
      </div>`;
    };
    return html`<section class="card">
      <h2 class="h-sec">Ce qu’on laisse à l’adversaire</h2>
      <p class="muted small">Quand notre service ou notre attaque passe sans marquer : l’adversaire est-il réduit à relancer, ou peut-il attaquer ?</p>
      ${row("Après nos services", o.srvRel, o.srvAtt)}
      ${row("Après nos attaques", o.attRel, o.attAtt)}
      <ul class="legend"><li><span class="sw l2"></span>Relance adverse (incisif)</li><li><span class="sw l3"></span>Attaque adverse (cadeau)</li></ul>
      ${nSets ? html`<details class="data-view"><summary>Détail set par set</summary>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col" class="left"></th>${per.map((_, i) => html`<th scope="col" key=${i}>Set ${i + 1}</th>`)}<th scope="col">Total</th></tr></thead>
          <tbody>
            ${line("Après service : relances", "srvRel")}${line("Après service : attaques", "srvAtt")}
            ${line("Après attaque : relances", "attRel")}${line("Après attaque : attaques", "attAtt")}
          </tbody>
        </table></div></details>` : null}
    </section>`;
  }
  function Summary({ m, me, go, openSheet }) {
    const comp = completion(m.id);
    const filled = comp.ps.filter((p) => C.isFilled(p.doc));
    const allSets = filled.map((p) => C.setsArray(p.doc));
    const flat = [].concat.apply([], allSets);
    const sl = C.scoreLine(flat);
    const perSet = [0, 1, 2, 3, 4].map((i) => C.scoreLine(allSets.map((s) => s[i])));
    return html`<div class="summary-grid"><div class="col">
      <${Completion} comp=${comp} me=${me} m=${m} go=${go} />
      <section class="card">
        <h2 class="h-sec">L’équipe sur ce match</h2>
        <div class="kpis">
          <div class="kpi"><span class="kpi-l">Points marqués</span><span class="kpi-v">${sl.P}</span><span class="kpi-s">Attaque ${sl.pts.attaque} · Service ${sl.pts.service} · Bloc ${sl.pts.bloc}</span></div>
          <div class="kpi"><span class="kpi-l">Fautes</span><span class="kpi-v">${sl.F}</span><span class="kpi-s">Att. ${sl.flt.attaque} · Serv. ${sl.flt.service} · Récep. ${sl.flt.reception} · Passe ${sl.flt.passe}</span></div>
          <div class="kpi"><span class="kpi-l">Différence</span><span class=${cx("kpi-v", sl.diff > 0 && "pos", sl.diff < 0 && "neg")}>${signed(sl.diff)}</span><span class="kpi-s">Sur ${plural(filled.length, "fiche", "fiches")}</span></div>
        </div>
        <div class="meters">
          ${C.SKILLS.map((s) => { const r = C.sumSkill(flat, s.key); return html`<${Meter} key=${s.key} r=${r} label=${s.label} sub=${r.total ? r.ok + " " + U.agree(s.rateName, r.ok) + " sur " + r.total : "Aucune action saisie"} />`; })}
        </div>
        <p class="muted small">Taux calculés sur l’ensemble des gestes du match (et non en moyenne des sets).</p>
      </section>
      </div><div class="col">
      <${ScoreCheck} m=${m} perSet=${perSet} openForm=${() => openSheet({ type: "match-form", m })} />
      <${Opponent} allSets=${allSets} nSets=${playedSets(m, allSets)} />
    </div></div>`;
  }
  /* Tableau joueurs × sets, comme les feuilles « STATS Points » et « STATS Taux de transformation » de l’Excel. */
  function SetDetail({ m, filled, nSets }) {
    const [k, setK] = useState("P");
    const opts = [{ k: "P", label: "Points marqués" }, { k: "F", label: "Points perdus" }, { k: "diff", label: "Différence" }]
      .concat(C.SKILLS.map((s) => ({ k: s.key, label: "Taux " + s.label.toLowerCase(), rate: true })));
    const d = opts.find((x) => x.k === k) || opts[0];
    const cols = Array.from({ length: nSets }, (_, i) => i);
    const all = filled.map((p) => ({ p, sets: C.setsArray(p.doc) }));
    const teamSet = (i) => all.map((x) => x.sets[i]);
    const cell = (sets) => {
      if (d.rate) {
        const r = C.sumSkill(sets, d.k);
        return r.total ? html`${pct(r.rate)}<small>${r.ok}/${r.total}</small>` : html`<span class="muted">–</span>`;
      }
      const v = C.scoreLine(sets)[d.k];
      return d.k === "diff" ? signed(v) : v;
    };
    const sc = C.matchSets(m);
    const withScore = (d.k === "P" || d.k === "F") && sc.length;
    const scoreOf = (s) => (d.k === "P" ? s.a : s.o);
    return html`<section class="card">
      <div class="block-head"><h2 class="h-sec">Détail set par set</h2><span class="muted small">Les tableaux des feuilles STATS de l’Excel</span></div>
      <div class="filter-row" role="group" aria-label="Statistique affichée">
        ${opts.map((o) => html`<button key=${o.k} class=${cx("pill sm", k === o.k && "on")} aria-pressed=${k === o.k} onClick=${() => setK(o.k)}>${o.label}</button>`)}
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th scope="col" class="left">Joueur</th>${cols.map((i) => html`<th scope="col" key=${i}>Set ${i + 1}</th>`)}<th scope="col">Match</th></tr></thead>
        <tbody>${all.map(({ p, sets }) => html`<tr key=${p.id}><th scope="row" class="left">${p.name}</th>
          ${cols.map((i) => html`<td key=${i}>${C.countActions(sets[i]) ? cell([sets[i]]) : html`<span class="muted" title="Pas de stat sur ce set">–</span>`}</td>`)}
          <td><b>${cell(sets)}</b></td></tr>`)}</tbody>
        <tfoot>
          <tr><th scope="row" class="left">Équipe</th>${cols.map((i) => html`<td key=${i}>${cell(teamSet(i))}</td>`)}<td>${cell([].concat.apply([], all.map((x) => x.sets)))}</td></tr>
          ${withScore ? html`<tr class="sub"><th scope="row" class="left">${d.k === "P" ? "Score ASVP" : "Score " + m.opponent}</th>
              ${cols.map((i) => html`<td key=${i}>${sc[i] ? scoreOf(sc[i]) : "–"}</td>`)}<td>${sc.reduce((t, s) => t + scoreOf(s), 0)}</td></tr>
            <tr class="sub"><th scope="row" class="left">${m.closed ? "Points non notés (non comptabilisés)" : "Écart avec le score"}</th>
              ${cols.map((i) => html`<td key=${i}>${sc[i] ? scoreOf(sc[i]) - C.scoreLine(teamSet(i))[d.k] : "–"}</td>`)}
              <td>${sc.reduce((t, s) => t + scoreOf(s), 0) - C.scoreLine([].concat.apply([], all.map((x) => x.sets)))[d.k]}</td></tr>` : null}
        </tfoot>
      </table></div>
      <p class="muted small">${withScore
        ? (m.closed ? "Saisie close : les points non notés (moments sans vidéo, ou fautes de l’adversaire) ne sont pas comptabilisés."
          : d.k === "P" ? "Écart = points venus des fautes adverses ou d’actions non saisies." : "Écart = points marqués par l’adversaire sur ses propres actions, ou non saisis.")
        : d.rate ? C.SKILL[d.k].rateText + ", set par set et sur le match." : "« – » : pas de stat sur ce set (joueur pas sur le terrain)."}</p>
    </section>`;
  }
  function Players({ m, openSheet }) {
    const [sel, setSel] = useState(0);
    const comp = completion(m.id);
    const filled = comp.ps.filter((p) => C.isFilled(p.doc));
    const nSets = Math.max(1, playedSets(m, filled.map((p) => C.setsArray(p.doc))));
    const rows = filled.map((p) => {
      const sets = C.setsArray(p.doc);
      const use = sel ? [sets[sel - 1]] : sets;
      return { p, use, sl: C.scoreLine(use) };
    }).filter((r) => !sel || r.sl.actions > 0).sort((a, b) => b.sl.P - a.sl.P || b.sl.diff - a.sl.diff || a.p.name.localeCompare(b.p.name));
    const maxD = Math.max(1, ...rows.map((r) => Math.abs(r.sl.diff)));
    const team = [].concat.apply([], rows.map((r) => r.use));
    const missing = comp.ps.filter((p) => !C.isFilled(p.doc));
    const skillsCols = ["service", "reception", "passe", "attaque", "bloc"];
    return html`
      <div class="filter-row" role="group" aria-label="Période">
        ${[0].concat(Array.from({ length: nSets }, (_, i) => i + 1)).map((n) => html`<button key=${n} class=${cx("pill", sel === n && "on")} aria-pressed=${sel === n} onClick=${() => setSel(n)}>${n ? "Set " + n : "Match entier"}</button>`)}
      </div>
      ${!rows.length ? html`<section class="card empty-state"><p>Personne n’a encore saisi ses stats pour ce match.</p></section>` : html`
      <section class="card">
        <h2 class="h-sec">Points et fautes</h2>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th scope="col" class="left">Joueur</th><th scope="col">Points</th><th scope="col">Fautes</th><th scope="col" class="left">+/−</th></tr></thead>
          <tbody>${rows.map(({ p, sl }) => html`<tr key=${p.id}>
            <th scope="row" class="left"><button class="linkish" onClick=${() => openSheet({ type: "player", p, m })}>${p.name}</button>
              <small>A ${sl.pts.attaque} · S ${sl.pts.service} · B ${sl.pts.bloc}</small></th>
            <td><b>${sl.P}</b></td><td>${sl.F}<small>A ${sl.flt.attaque} · S ${sl.flt.service} · R ${sl.flt.reception} · P ${sl.flt.passe}</small></td>
            <td class="left diff"><span class=${cx("diff-n", sl.diff > 0 && "pos", sl.diff < 0 && "neg")}>${signed(sl.diff)}</span><${DiffBar} v=${sl.diff} max=${maxD} /></td>
          </tr>`)}</tbody>
          <tfoot><tr><th scope="row" class="left">Équipe</th><td><b>${C.scoreLine(team).P}</b></td><td>${C.scoreLine(team).F}</td><td class="left"><b>${signed(C.scoreLine(team).diff)}</b></td></tr></tfoot>
        </table></div>
        <p class="muted small">A attaque · S service · B bloc · R réception · P passe. Touche un nom pour voir sa fiche.</p>
      </section>
      <section class="card">
        <h2 class="h-sec">Taux de transformation</h2>
        <div class="tbl-wrap"><table class="tbl rates">
          <thead><tr><th scope="col" class="left">Joueur</th>${skillsCols.map((k) => html`<th scope="col" key=${k}>${C.SKILL[k].label}</th>`)}</tr></thead>
          <tbody>${rows.map(({ p, use }) => html`<tr key=${p.id}><th scope="row" class="left">${p.name}${q.posteLabel(p.id) ? html`<small>${q.posteLabel(p.id)}</small>` : null}</th>
            ${skillsCols.map((k) => { const r = C.sumSkill(use, k); return html`<td key=${k}>${r.total ? html`<${RateChip} r=${r} compact />` : html`<span class="muted">–</span>`}${r.total ? html`<small>${r.ok}/${r.total}</small>` : null}</td>`; })}
          </tr>`)}</tbody>
          <tfoot><tr><th scope="row" class="left">Équipe</th>${skillsCols.map((k) => { const r = C.sumSkill(team, k); return html`<td key=${k}>${r.total ? html`<${RateChip} r=${r} compact />` : "–"}${r.total ? html`<small>${r.ok}/${r.total}</small>` : null}</td>`; })}</tr></tfoot>
        </table></div>
      </section>
      <${SetDetail} m=${m} filled=${filled} nSets=${nSets} />`}
      ${sel && filled.length > rows.length ? html`<p class="muted small">Aucune stat sur le set ${sel} (pas joué) : ${filled.filter((p) => !C.countActions(C.setsArray(p.doc)[sel - 1])).map((p) => p.name).join(", ")}.</p>` : null}
      ${missing.length ? html`<p class="muted small">${m.closed ? "Sans fiche (saisie close)" : "Pas encore de fiche"} : ${missing.map((p) => p.name).join(", ")}.</p>` : null}`;
  }
  function Bilans({ m }) {
    const ps = q.playersOf(m.id).filter((p) => p.doc && C.hasBilan(p.doc));
    if (!ps.length) return html`<section class="card empty-state"><p>Aucun bilan écrit pour ce match.</p></section>`;
    const quotes = (k) => ps.filter((p) => p.doc.bilan[k] && p.doc.bilan[k].trim()).map((p) => html`<li key=${p.id}><p>${p.doc.bilan[k]}</p><cite>${p.name}</cite></li>`);
    return html`
      <section class="card">
        <h2 class="h-sec">Bilan collectif</h2>
        <div class="two-col">
          <div><h3 class="h-sub plus">Les +</h3><ul class="quotes">${quotes("cp")}</ul></div>
          <div><h3 class="h-sub minus">Les −</h3><ul class="quotes">${quotes("cm")}</ul></div>
        </div>
      </section>
      <section class="card">
        <h2 class="h-sec">Bilans perso</h2>
        <div class="perso-list">
          ${ps.filter((p) => (p.doc.bilan.pp || "").trim() || (p.doc.bilan.pm || "").trim()).map((p) => html`<article class="perso" key=${p.id}>
            <h3>${p.name}</h3>
            ${p.doc.bilan.pp && html`<p><span class="tag plus">+</span>${p.doc.bilan.pp}</p>`}
            ${p.doc.bilan.pm && html`<p><span class="tag minus">−</span>${p.doc.bilan.pm}</p>`}
          </article>`)}
        </div>
      </section>`;
  }
  function MatchView({ matchId, me, go, openSheet, sub, setSub }) {
    const m = store.matches[matchId];
    const [busy, setBusy] = useState(false);
    if (!m) return html`<div class="page"><section class="card empty-state"><p>Ce match n’existe plus.</p><button class="btn ghost" onClick=${() => go({ view: "home" })}>Retour aux matchs</button></section></div>`;
    const sets = C.matchSets(m);
    const r = C.matchResult(m);
    const doExport = async () => {
      setBusy(true);
      try {
        const res = await root.StatorIO.exportMatch(m);
        U.toast(res === "saved" ? "Fichier Excel prêt." : res === "declined" ? "Téléchargement annulé." : "Téléchargement impossible dans cette vue.");
      } catch (e) { U.toast("Impossible de préparer l’Excel : vérifie ta connexion."); }
      setBusy(false);
    };
    const tabs = [["synthese", "Synthèse"], ["joueurs", "Joueurs"], ["bilans", "Bilans"]];
    const toggleClosed = () => {
      api.saveMatch(Object.assign({}, m, { closed: !m.closed, updatedAt: new Date().toISOString() }));
      U.toast(m.closed ? "Saisie rouverte : les joueurs peuvent à nouveau remplir leur fiche." : "Saisie close : les points non notés ne sont pas comptabilisés.");
    };
    return html`<div>
      <section class="match-band">
        <div class="match-band-in">
          <button class="icon-btn on-band" onClick=${() => go({ view: "home" })} aria-label="Retour aux matchs"><${Icon} name="back" /></button>
          <div class="mb-main">
            <span class="eyebrow on-band">${fmtDate(m.date)}${venueLabel(m.venue) ? " · " + venueLabel(m.venue) : ""}${m.competition ? " · " + m.competition : ""}</span>
            <div class="board sm"><span class="board-team">ASVP</span><span class="board-score">${r ? r.a : "–"}<i>–</i>${r ? r.o : "–"}</span><span class="board-team opp">${m.opponent}</span></div>
            <div class="board-sets">${sets.length ? sets.map((s, i) => html`<span key=${i}>${s.a}–${s.o}</span>`) : html`<span class="muted-band">Score des sets non renseigné</span>`}</div>
            ${m.noData && html`<div class="board-sets"><${NoDataBadge} /></div>`}
            ${m.closed && !m.noData && html`<div class="board-sets"><${ClosedBadge} band /></div>`}
          </div>
        </div>
        <div class="match-actions">
          ${!store.readOnly && !m.noData && !m.closed && html`<button class="btn primary sm" onClick=${() => go({ view: "entry", matchId })}>Saisir les stats</button>`}
          ${m.video && html`<a class="btn on-band-ghost sm" href=${m.video} target="_blank" rel="noopener noreferrer"><${Icon} name="play" size=${16} />Vidéo YouTube</a>`}
          ${m.videoKind === "discord" && html`<span class="video-chip" title=${m.videoNote || ""}><${Icon} name="play" size=${15} />Vidéo : fichier sur Discord${m.videoNote ? " · " + m.videoNote : ""}</span>`}
          ${!store.readOnly && !m.noData && html`<button class="btn on-band-ghost sm" onClick=${toggleClosed}><${Icon} name=${m.closed ? "undo" : "check"} size=${16} />${m.closed ? "Rouvrir la saisie" : "Clôturer la saisie"}</button>`}
          ${!m.noData && html`<button class="btn on-band-ghost sm" onClick=${doExport} disabled=${busy}><${Icon} name="down" size=${16} />${busy ? "Préparation…" : "Excel"}</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "match-form", m })}><${Icon} name="edit" size=${16} />Modifier</button>`}
          ${!store.readOnly && html`<button class="btn on-band-ghost sm" onClick=${() => openSheet({ type: "delete", m })} aria-label="Supprimer le match"><${Icon} name="trash" size=${16} /></button>`}
        </div>
        ${!m.noData && html`<div class="subtabs" role="tablist">
          ${tabs.map(([k, l]) => html`<button key=${k} role="tab" aria-selected=${sub === k} class=${sub === k ? "on" : ""} onClick=${() => setSub(k)}>${l}</button>`)}
        </div>`}
      </section>
      <div class="page wide">
        ${m.noData ? html`<${NoDataPanel} m=${m} openSheet=${openSheet} />`
          : sub === "joueurs" ? html`<${Players} m=${m} openSheet=${openSheet} />` : sub === "bilans" ? html`<${Bilans} m=${m} />` : html`<${Summary} m=${m} me=${me} go=${go} openSheet=${openSheet} />`}
      </div>
    </div>`;
  }
  /* Match enregistré sans vidéo : le score seulement. */
  function NoDataPanel({ m, openSheet }) {
    const sets = C.matchSets(m);
    const r = C.matchResult(m);
    const hasStats = q.statsOf(m.id).some((d) => C.isFilled(d));
    return html`<section class="card nodata-card">
      <h2 class="h-sec"><${NoDataBadge} /> Match sans vidéo</h2>
      <p>Pas de vidéo pour ce match : seul le score est enregistré, sans fiches de stats. Il compte dans le bilan de la saison (victoires, sets), pas dans les stats des joueurs.</p>
      ${r && html`<p class="nodata-score"><b>ASVP ${r.a} – ${r.o} ${m.opponent}</b>${sets.length ? html` <span class="muted">(${sets.map((s) => s.a + "–" + s.o).join(", ")})</span>` : null}</p>`}
      ${hasStats && html`<p class="warn small">Des fiches existent quand même pour ce match : elles sont conservées, mais masquées tant que le match est marqué NO VIDEO / NO DATA.</p>`}
      ${!store.readOnly && html`<div class="row-btns"><button class="btn ghost" onClick=${() => openSheet({ type: "match-form", m })}><${Icon} name="edit" size=${18} />La vidéo est arrivée ? Modifier le match</button></div>`}
    </section>`;
  }
  function ClosedBadge({ band }) {
    return html`<span class=${cx("closed-badge", band && "band")}><${Icon} name="check" size=${13} />Saisie close</span>`;
  }
  function NoDataBadge({ sm }) {
    return html`<span class=${cx("nodata-badge", sm && "sm")} title="Pas de vidéo : score seulement">NO VIDEO / NO DATA</span>`;
  }
  function PlayerDetail({ p, m }) {
    const [busy, setBusy] = useState(false);
    const doc = q.doc(m.id, p.id);
    const sets = C.setsArray(doc);
    const b = (doc && doc.bilan) || {};
    const download = async () => {
      setBusy(true);
      try {
        const res = await root.StatorIO.exportPlayer(m, p.name, doc);
        U.toast(res === "saved" ? "Fiche Excel prête." : res === "declined" ? "Téléchargement annulé." : "Téléchargement impossible dans cette vue.");
      } catch (e) { U.toast("Impossible de préparer le fichier : vérifie ta connexion."); }
      setBusy(false);
    };
    return html`<div>
      <div class="row-btns detail-actions">
        <button class="btn ghost sm" onClick=${download} disabled=${busy}><${Icon} name="down" size=${16} />${busy ? "Préparation…" : "Fiche Excel de " + p.name}</button>
        <span class="muted small">À coller dans son onglet de l’Excel du coach (voir le Tuto).</span>
      </div>
      <${Recap} sets=${sets} />
      ${C.hasBilan(doc) && html`<section class="perso">
        ${b.pp && html`<p><span class="tag plus">+</span>${b.pp}</p>`}${b.pm && html`<p><span class="tag minus">−</span>${b.pm}</p>`}
        ${(b.cp || b.cm) && html`<h3 class="h-sub">Sur l’équipe</h3>`}
        ${b.cp && html`<p><span class="tag plus">+</span>${b.cp}</p>`}${b.cm && html`<p><span class="tag minus">−</span>${b.cm}</p>`}
      </section>`}
    </div>`;
  }
  function DeleteMatch({ m, onDone, onCancel }) {
    const n = q.statsOf(m.id).length;
    return html`<div>
      <p>Supprimer le match contre <b>${m.opponent}</b>${n ? html` et ${plural(n, "fiche joueur", "fiches joueurs")}` : null} ? Cette action est définitive pour toute l’équipe.</p>
      <div class="row-btns end"><button class="btn ghost" onClick=${onCancel}>Garder le match</button>
        <button class="btn danger" onClick=${() => { api.deleteMatch(m.id); onDone(); }}>Supprimer</button></div>
    </div>`;
  }

  root.StatorMatch = { Home, MatchView, MatchForm, NewMatch, SkillHelp, WhoGrid, PlayerDetail, DeleteMatch, venueLabel, ResultChip };
})(window);
