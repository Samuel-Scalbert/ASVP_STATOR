/* ASVP Stator — saisie d’une fiche joueur : comptage set par set puis bilan, vidéo du match à côté. */
(function (root) {
  "use strict";
  const { html, useState, useEffect, useRef } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q, lsGet, lsSet } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, Tile, RateChip, Recap, cx } = U;

  function newDoc(matchId, playerId) {
    return { id: C.statId(matchId, playerId), matchId, playerId, sets: {}, bilan: { pp: "", pm: "", cp: "", cm: "" }, updatedAt: "" };
  }
  function cleanSets(doc) {
    Object.keys(doc.sets).forEach((n) => {
      const set = doc.sets[n];
      Object.keys(set).forEach((sk) => { if (!Object.keys(set[sk]).length) delete set[sk]; });
      if (!Object.keys(set).length) delete doc.sets[n];
    });
  }
  const fieldAria = (s, f) => s.label + " " + f.label.toLowerCase() + (f.p ? " poste " + f.p : "");

  /* Une compétence (service, bloc…) : une case par résultat, + au toucher, − dans le coin. */
  function TapPad({ s, set, onBump, onMinus }) {
    const val = (f) => C.setVal(set, s.key, f.k);
    const tile = (f, cell) => html`<${Tile} key=${f.k} f=${f} cell=${cell} n=${val(f)}
      onTap=${() => onBump(s.key, f.k)} onMinus=${() => onMinus(s.key, f.k)} aria=${fieldAria(s, f)} />`;
    if (!s.hasPostes) return html`<div class=${"pad c" + s.fields.length}>${s.fields.map((f) => tile(f, false))}</div>`;
    const rows = [];
    s.fields.forEach((f) => { if (f.p && rows.indexOf(f.o) < 0) rows.push(f.o); });
    const extras = s.fields.filter((f) => !f.p);
    return html`<div class="matrix">
      <div class="mx-head"><span></span>${C.POSTES.map((p) => html`<span key=${p.n}><b>${p.label}</b><small>${p.sub}</small></span>`)}</div>
      ${rows.map((o) => {
        const oc = s.outcomes[o];
        return html`<div class="mx-row" key=${o}>
          <div class=${"mx-lbl l" + oc.lvl}><b>${oc.label}${oc.pt ? html` <span class=${cx("tile-pt inline", oc.pt > 0 ? "plus" : "minus")}>${oc.pt > 0 ? "+1 pt" : "−1 pt"}</span>` : null}</b><small>${oc.hint}</small></div>
          ${C.POSTES.map((p) => tile(s.fields.find((x) => x.o === o && x.p === p.n), true))}
        </div>`;
      })}
      <div class=${"pad c" + extras.length}>${extras.map((f) => tile(f, false))}</div>
    </div>`;
  }

  function SkillBlock({ s, set, onBump, onMinus, onHelp }) {
    const r = C.sumSkill([set], s.key);
    return html`<section class="skill" aria-labelledby=${"sk-" + s.key}>
      <header class="skill-head">
        <h3 id=${"sk-" + s.key}>${s.long}</h3>
        <button type="button" class="help-btn" onClick=${() => onHelp(s.key)} aria-label=${"Comment compter : " + s.label}><${Icon} name="info" size=${18} /><span>Comment compter</span></button>
        <span class="skill-rate"><${RateChip} r=${r} /></span>
      </header>
      <${TapPad} s=${s} set=${set} onBump=${onBump} onMinus=${onMinus} />
    </section>`;
  }

  function TextField({ id, label, hint, value, onInput, placeholder }) {
    return html`<div class="field">
      <label for=${id}><b>${label}</b><small>${hint}</small></label>
      <textarea id=${id} rows="3" value=${value} placeholder=${placeholder} onInput=${(e) => onInput(e.target.value)}></textarea>
    </div>`;
  }

  /* La fiche d’un joueur (remontée à chaque changement de joueur). */
  function SheetEditor({ m, playerId, go, onHelp, onSwitch, videoCtl }) {
    const matchId = m.id;
    const docId = C.statId(matchId, playerId);
    const [doc, setDoc] = useState(() => C.clone(store.stats[docId]) || newDoc(matchId, playerId));
    const docRef = useRef(doc);
    const touched = useRef(false);
    const known = C.matchSetCount(m);
    const highest = Math.max(0, ...Object.keys(doc.sets).map(Number).filter((n) => C.countActions(doc.sets[n]) > 0));
    const [added, setAdded] = useState(0);
    const nSets = Math.min(C.MAX_SETS, Math.max(known || 3, highest, added));
    const [tabRaw, setTab] = useState(() => lsGet("asvp-stator-tab-" + docId, 1));
    const tab = tabRaw === "bilan" || (Number.isInteger(tabRaw) && tabRaw >= 1 && tabRaw <= nSets) ? tabRaw : 1;
    const [undo, setUndo] = useState([]);
    const [tipOff, setTipOff] = useState(() => lsGet("asvp-stator-tip2", false));
    const [exporting, setExporting] = useState(false);
    const exportSheet = async () => {
      setExporting(true);
      try {
        const res = await root.StatorIO.exportPlayer(m, q.name(playerId), docRef.current);
        U.toast(res === "saved" ? "Fiche Excel prête." : res === "declined" ? "Téléchargement annulé." : "Téléchargement impossible dans cette vue.");
      } catch (e) { U.toast("Impossible de préparer le fichier : vérifie ta connexion."); }
      setExporting(false);
    };

    // Si la fiche arrive de la base après l’ouverture et qu’on n’a encore rien touché, on la reprend.
    useEffect(() => {
      const remote = store.stats[docId];
      if (!touched.current && remote && JSON.stringify(remote) !== JSON.stringify(docRef.current)) {
        const c = C.clone(remote);
        docRef.current = c; setDoc(c);
      }
    }, [store.v]);
    useEffect(() => { lsSet("asvp-stator-tab-" + docId, tab); }, [tab]);
    useEffect(() => () => api.flush(), []);

    const readOnly = store.readOnly;
    function commit(next) {
      next.updatedAt = new Date().toISOString();
      cleanSets(next);
      touched.current = true;
      docRef.current = next;
      setDoc(next);
      api.saveStats(next);
    }
    function change(setNo, sk, k, delta) {
      if (readOnly) return false;
      const next = C.clone(docRef.current);
      const set = (next.sets[setNo] = next.sets[setNo] || {});
      const g = (set[sk] = set[sk] || {});
      const before = g[k] || 0;
      const v = Math.max(0, before + delta);
      if (v === before) return false;
      if (v) g[k] = v; else delete g[k];
      commit(next);
      return true;
    }
    const bump = (sk, k) => {
      if (!change(tab, sk, k, 1)) return;
      setUndo((u) => u.concat([{ set: tab, sk, k }]).slice(-60));
      try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* pas de vibreur */ }
    };
    const minus = (sk, k) => {
      if (!change(tab, sk, k, -1)) return;
      // La touche retirée ne doit plus pouvoir être « annulée » une seconde fois.
      setUndo((u) => {
        for (let i = u.length - 1; i >= 0; i--) if (u[i].set === tab && u[i].sk === sk && u[i].k === k) return u.slice(0, i).concat(u.slice(i + 1));
        return u;
      });
    };
    const undoLast = () => {
      const last = undo[undo.length - 1];
      if (!last) return;
      change(last.set, last.sk, last.k, -1);
      setUndo(undo.slice(0, -1));
      if (last.set !== tab) setTab(last.set);
    };
    const setBilan = (k, v) => {
      if (readOnly) return;
      const next = C.clone(docRef.current);
      next.bilan = Object.assign({ pp: "", pm: "", cp: "", cm: "" }, next.bilan, { [k]: v });
      commit(next);
    };

    const sets = C.setsArray(doc);
    const onSet = tab !== "bilan";
    const cur = onSet ? sets[tab - 1] : null;
    const sl = onSet ? C.scoreLine([cur]) : null;
    const last = undo[undo.length - 1];
    const lastLabel = last ? (() => { const s = C.SKILL[last.sk]; const f = s.fields.find((x) => x.k === last.k); return s.label + " " + f.label.toLowerCase() + (f.p ? " P" + f.p : "") + (last.set !== tab ? " (set " + last.set + ")" : ""); })() : "";
    const tabs = [];
    for (let i = 1; i <= nSets; i++) tabs.push(i);
    const nextTab = !onSet ? null : tab < nSets ? tab + 1 : "bilan";
    // Joueurs du match d’abord ; les autres restent accessibles en cas d’oubli dans la liste.
    const squadIds = q.squadOf(matchId);
    const inMatch = squadIds ? q.roster().filter((p) => squadIds.indexOf(p.id) >= 0) : q.active();
    const others = squadIds ? q.active().filter((p) => squadIds.indexOf(p.id) < 0) : [];
    const players = inMatch.concat(others);
    const idx = inMatch.findIndex((p) => p.id === playerId);
    const nextPlayer = idx >= 0 && idx < inMatch.length - 1 ? inMatch[idx + 1] : null;
    const opt = (p) => html`<option key=${p.id} value=${p.id}>${p.name}${q.posteLabel(p.id) ? " · " + q.posteLabel(p.id) : ""}</option>`;
    const poste = q.posteLabel(playerId);

    return html`<div class="entry-inner">
      <div class="entry-band">
        <div class="entry-band-in">
          <button class="icon-btn on-band" onClick=${() => go({ view: "match", matchId })} aria-label="Retour au match"><${Icon} name="back" /></button>
          <div class="entry-title">
            <span class="eyebrow on-band">ASVP – ${m.opponent}</span>
            <label class="player-pick">
              <span class="sr-only">Joueur</span>
              <select id="entry-player" value=${playerId} onChange=${(e) => onSwitch(e.target.value)}>
                ${players.some((p) => p.id === playerId) ? null : html`<option value=${playerId}>${q.name(playerId)}</option>`}
                ${others.length
                  ? html`<optgroup label="Joueurs du match">${inMatch.map(opt)}</optgroup><optgroup label="Autres joueurs">${others.map(opt)}</optgroup>`
                  : inMatch.map(opt)}
              </select>
            </label>
          </div>
          ${videoCtl}
        </div>
        <div class="set-tabs" role="tablist" aria-label="Sets">
          ${tabs.map((n) => {
            const idle = !C.countActions(sets[n - 1]);
            return html`<button key=${n} role="tab" aria-selected=${tab === n} class=${cx("set-tab", tab === n && "on", idle && "idle")}
              title=${idle ? "Aucune stat sur ce set : pas joué ?" : null} onClick=${() => setTab(n)}><span>Set ${n}</span></button>`;
          })}
          ${!known && nSets < C.MAX_SETS && html`<button class="set-tab add" onClick=${() => { setAdded(nSets + 1); setTab(nSets + 1); }} aria-label="Ajouter un set"><span>+ Set</span></button>`}
          <button role="tab" aria-selected=${tab === "bilan"} class=${cx("set-tab", "bilan", tab === "bilan" && "on")} onClick=${() => setTab("bilan")}><span>Bilan</span></button>
        </div>
      </div>

      <div class="page wide entry-page">
        ${readOnly && html`<p class="notice ro">Lecture seule : tu peux consulter cette fiche mais pas la modifier.</p>`}
        ${onSet ? html`
          <div class="set-sum" aria-live="polite">
            <span class="set-sum-t">Set ${tab}</span>
            <span><b>${sl.P}</b> ${sl.P > 1 ? "points marqués" : "point marqué"}</span>
            <span><b>${sl.F}</b> ${sl.F > 1 ? "fautes" : "faute"}</span>
            ${!sl.actions && html`<span class="set-idle">Aucune stat sur ce set : si ${q.name(playerId)} n’a pas joué, laisse-le vide.</span>`}
          </div>
          ${!tipOff && html`<div class="tip-card">
            <div><b>Une touche = +1.</b> Le <b>−</b> dans le coin d’une case retire 1, « Annuler » efface la dernière touche. « Comment compter » explique chaque case.</div>
            <button class="icon-btn" aria-label="Masquer l’astuce" onClick=${() => { setTipOff(true); lsSet("asvp-stator-tip2", true); }}><${Icon} name="x" size=${18} /></button>
          </div>`}
          <div class="skills-grid">
            ${[C.SKILLS.filter((s) => !s.hasPostes), C.SKILLS.filter((s) => s.hasPostes)].map((col, i) => html`<div class="skills-col" key=${i}>
              ${col.map((s) => html`<${SkillBlock} key=${s.key + tab} s=${s} set=${cur} onBump=${bump} onMinus=${minus} onHelp=${onHelp} />`)}
            </div>`)}
          </div>
        ` : html`
          <div class="bilan-grid">
          <${Recap} sets=${sets} title=${"Le match de " + q.name(playerId) + " en chiffres"} />
          <div class="bilan-col">
          <section class="card bilan-card">
            <h3 class="h-sec">Bilan perso</h3>
            <${TextField} id="b-pp" label="Les +" hint="Ce qui a bien marché" value=${doc.bilan.pp || ""} onInput=${(v) => setBilan("pp", v)} placeholder="Ex. : présent au bloc, bonnes relances au filet" />
            <${TextField} id="b-pm" label="Les −" hint="Ce qu’il faut travailler" value=${doc.bilan.pm || ""} onInput=${(v) => setBilan("pm", v)} placeholder="Ex. : service trop risqué, appuis au bloc" />
          </section>
          <section class="card bilan-card">
            <h3 class="h-sec">Bilan collectif</h3>
            <${TextField} id="b-cp" label="Les +" hint="Ce que l’équipe a bien fait" value=${doc.bilan.cp || ""} onInput=${(v) => setBilan("cp", v)} placeholder="Ex. : nos services les ont mis en difficulté" />
            <${TextField} id="b-cm" label="Les −" hint="Ce que l’équipe doit corriger" value=${doc.bilan.cm || ""} onInput=${(v) => setBilan("cm", v)} placeholder="Ex. : réception brouillonne sur les séries adverses" />
          </section>
          <section class="card export-card">
            <h3 class="h-sec">Excel du coach</h3>
            <p class="muted small">Le coach remplit encore son fichier ? Télécharge la fiche de ${q.name(playerId)} au même format, puis colle-la dans son onglet en deux copier-coller.</p>
            <div class="row-btns">
              <button class="btn dark" onClick=${exportSheet} disabled=${exporting}><${Icon} name="down" size=${18} />${exporting ? "Préparation…" : "Télécharger la fiche Excel"}</button>
              <button class="btn ghost" onClick=${() => go({ view: "tuto", anchor: "coach" })}>Comment l’ajouter ?</button>
            </div>
          </section>
          </div>
          </div>
        `}
      </div>

      <div class="entry-bar">
        <div class="entry-bar-in">
          ${onSet
            ? html`<button class="btn ghost undo" onClick=${undoLast} disabled=${!last || readOnly}>
                <${Icon} name="undo" size=${18} /><span class="undo-t">${last ? "Annuler : " + lastLabel : "Annuler"}</span></button>`
            : html`<span class="save-state">${store.sync === "saving" ? "Enregistrement…" : store.sync === "error" ? "Non enregistré" : "Enregistré automatiquement"}</span>`}
          ${nextTab
            ? html`<button class="btn primary" onClick=${() => { setTab(nextTab); root.scrollTo(0, 0); }}>${nextTab === "bilan" ? "Bilan" : "Set " + nextTab}<${Icon} name="next" size=${18} /></button>`
            : html`<div class="row-btns">
                ${nextPlayer && html`<button class="btn ghost" onClick=${() => { api.flush(); onSwitch(nextPlayer.id); root.scrollTo(0, 0); }}>Joueur suivant : ${nextPlayer.name}<${Icon} name="next" size=${18} /></button>`}
                <button class="btn primary" onClick=${() => { api.flush(); U.toast("Fiche de " + q.name(playerId) + " enregistrée."); go({ view: "match", matchId }); }}><${Icon} name="check" size=${18} />Terminer</button>
              </div>`}
        </div>
      </div>
    </div>`;
  }

  /* Écran de saisie : choix du joueur et vidéo du match (gardée quand on change de joueur). */
  function Entry({ matchId, playerId, go, onHelp }) {
    const m = store.matches[matchId];
    const [videoOn, setVideoOn] = useState(() => lsGet("asvp-stator-video", true));
    useEffect(() => { // écran allumé pendant le comptage
      let lock = null;
      try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {}); } catch (e) { /* refusé */ }
      return () => { try { lock && lock.release(); } catch (e) { /* déjà libéré */ } };
    }, []);
    if (!m) return html`<div class="page"><p class="empty-state">Ce match n’existe plus.</p></div>`;

    // Le lecteur intégré ne fonctionne qu’avec le serveur de l’équipe ; ailleurs, la vidéo s’ouvre dans YouTube.
    const embed = store.mode === "api" ? U.youtubeEmbed(m.video) : null;
    const showVideo = !!embed && videoOn;
    const toggle = (on) => { setVideoOn(on); lsSet("asvp-stator-video", on); };
    const videoCtl = m.video
      ? embed
        ? html`<button class=${cx("btn sm on-band-ghost video-btn", showVideo && "on")} aria-pressed=${showVideo} onClick=${() => toggle(!showVideo)}><${Icon} name="play" size=${16} /><span>${showVideo ? "Masquer la vidéo" : "Vidéo"}</span></button>`
        : html`<a class="btn sm on-band-ghost video-btn" href=${m.video} target="_blank" rel="noopener noreferrer"><${Icon} name="play" size=${16} /><span>Vidéo</span></a>`
      : null;
    const onSwitch = (id) => go({ view: "entry", matchId, playerId: id });

    return html`<div class=${cx("entry", showVideo && "with-video")}>
      ${showVideo && html`<aside class="video-dock" aria-label="Vidéo du match">
        <div class="video-frame"><iframe src=${embed} title=${"Vidéo du match ASVP – " + m.opponent}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>
        <p class="video-tip">Lance la vidéo et compte en direct : la vidéo reste là quand tu changes de set ou de joueur.</p>
      </aside>`}
      <${SheetEditor} key=${playerId} m=${m} playerId=${playerId} go=${go} onHelp=${onHelp} onSwitch=${onSwitch} videoCtl=${videoCtl} />
    </div>`;
  }

  root.StatorEntry = { Entry, newDoc };
})(window);
