/* ASVP Stator — saison, équipe, import. */
(function (root) {
  "use strict";
  const { html, useState } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, RateChip, RateChart, LevelLegend, cx, pct, signed, plural, fmtDate, shortDate } = U;

  /* ---------- Saison ---------- */
  function Season({ go }) {
    const [who, setWho] = useState("team");
    const [sort, setSort] = useState({ k: "P", dir: -1 });
    const [busy, setBusy] = useState(false);
    const matches = q.matchList().slice().reverse();
    const withData = matches.filter((m) => q.statsOf(m.id).some((d) => C.isFilled(d)));
    const res = matches.map((m) => C.matchResult(m)).filter(Boolean);
    const wins = res.filter((r) => r.a > r.o).length, losses = res.filter((r) => r.a < r.o).length;
    const setsW = res.reduce((s, r) => s + r.a, 0), setsL = res.reduce((s, r) => s + r.o, 0);
    const setsFor = (m) => {
      const ps = q.playersOf(m.id).filter((p) => C.isFilled(p.doc) && (who === "team" || p.id === who));
      return [].concat.apply([], ps.map((p) => C.setsArray(p.doc)));
    };
    const series = withData.filter((m) => who === "team" || C.isFilled(q.doc(m.id, who)));
    const chartSkills = ["service", "reception", "passe", "attaque"];
    const rows = q.roster().map((p) => {
      const ms = withData.filter((m) => C.isFilled(q.doc(m.id, p.id)));
      const all = [].concat.apply([], ms.map((m) => C.setsArray(q.doc(m.id, p.id))));
      const sl = C.scoreLine(all);
      const rates = {};
      ["service", "reception", "passe", "attaque", "bloc"].forEach((k) => { rates[k] = C.sumSkill(all, k); });
      return { p, n: ms.length, sl, rates, P: sl.P, F: sl.F, diff: sl.diff };
    }).filter((r) => r.n > 0);
    const val = (r, k) => (k in r ? r[k] : r.rates[k] && r.rates[k].rate == null ? -1 : r.rates[k].rate);
    if (sort.dir === -1) rows.sort((a, b) => val(b, sort.k) - val(a, sort.k) || a.p.name.localeCompare(b.p.name));
    else rows.sort((a, b) => val(a, sort.k) - val(b, sort.k) || a.p.name.localeCompare(b.p.name));
    const th = (k, label, sub) => html`<th scope="col" aria-sort=${sort.k === k ? (sort.dir < 0 ? "descending" : "ascending") : "none"}>
      <button class="sort" onClick=${() => setSort({ k, dir: sort.k === k ? -sort.dir : -1 })}>${label}${sort.k === k ? (sort.dir < 0 ? " ↓" : " ↑") : ""}</button>${sub ? html`<small>${sub}</small>` : null}</th>`;
    const doExport = async () => {
      setBusy(true);
      try { const r = await root.StatorIO.exportSeason(); U.toast(r === "saved" ? "Fichier Excel prêt." : r === "declined" ? "Téléchargement annulé." : "Téléchargement impossible dans cette vue."); }
      catch (e) { U.toast("Impossible de préparer l’Excel : vérifie ta connexion."); }
      setBusy(false);
    };
    const whoName = who === "team" ? "l’équipe" : q.name(who);
    const perso = who !== "team" ? withData.map((m) => ({ m, d: q.doc(m.id, who) })).filter((x) => x.d && C.hasBilan(x.d)).reverse() : [];

    return html`<div class="page wide">
      <div class="page-head">
        <div><span class="eyebrow">Saison ${(store.config && store.config.season) || C.seasonOf((matches.find((m) => m.date) || {}).date) || C.seasonOf(new Date().toISOString().slice(0, 10))}</span><h1 class="h-page">La saison en chiffres</h1></div>
        <button class="btn ghost sm" onClick=${doExport} disabled=${busy || !matches.length}><${Icon} name="down" size=${16} />${busy ? "Préparation…" : "Excel de la saison"}</button>
      </div>
      <div class="kpis season-kpis">
        <div class="kpi"><span class="kpi-l">Matchs</span><span class="kpi-v">${matches.length}</span><span class="kpi-s">${plural(withData.length, "avec des stats", "avec des stats")}</span></div>
        <div class="kpi"><span class="kpi-l">Victoires</span><span class="kpi-v">${wins}</span><span class="kpi-s">${plural(losses, "défaite", "défaites")}</span></div>
        <div class="kpi"><span class="kpi-l">Sets</span><span class="kpi-v">${setsW}–${setsL}</span><span class="kpi-s">gagnés – perdus</span></div>
      </div>

      <div class="filter-row">
        <label for="who-sel" class="lbl-inline">Voir</label>
        <select id="who-sel" value=${who} onChange=${(e) => setWho(e.target.value)}>
          <option value="team">L’équipe</option>
          ${q.roster().map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        </select>
      </div>

      <section class="card">
        <h2 class="h-sec">Taux de transformation, match par match · ${whoName}</h2>
        ${series.length < 2 ? html`
          <p class="muted small">${series.length ? "Un seul match saisi pour l’instant : la courbe apparaîtra dès le deuxième." : "Aucune stat saisie pour l’instant."}</p>
          ${series.length ? html`<div class="meters">${chartSkills.map((k) => { const r = C.sumSkill(setsFor(series[0]), k); return html`<${U.Meter} key=${k} r=${r} label=${C.SKILL[k].label} sub=${r.total ? r.ok + "/" + r.total + " · " + series[0].opponent : "Aucune action"} />`; })}</div>` : null}
        ` : html`<div class="charts">
          ${chartSkills.map((k) => html`<${RateChart} key=${k} title=${C.SKILL[k].label}
            pts=${series.map((m) => { const r = C.sumSkill(setsFor(m), k); return { label: m.opponent.slice(0, 9), full: m.opponent + " · " + shortDate(m.date), rate: r.rate, ok: r.ok, total: r.total }; })} />`)}
        </div>
        <details class="data-view"><summary>Voir les données</summary>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th scope="col" class="left">Match</th>${chartSkills.map((k) => html`<th scope="col" key=${k}>${C.SKILL[k].label}</th>`)}</tr></thead>
            <tbody>${series.map((m) => html`<tr key=${m.id}><th scope="row" class="left">${m.opponent}<small>${shortDate(m.date)}</small></th>
              ${chartSkills.map((k) => { const r = C.sumSkill(setsFor(m), k); return html`<td key=${k}>${pct(r.rate)}<small>${r.ok}/${r.total}</small></td>`; })}</tr>`)}</tbody>
          </table></div></details>`}
      </section>

      <section class="card">
        <h2 class="h-sec">Joueurs sur la saison</h2>
        ${!rows.length ? html`<p class="muted">Les totaux apparaîtront après les premières saisies.</p>` : html`
        <div class="tbl-wrap"><table class="tbl rates">
          <thead><tr><th scope="col" class="left">Joueur</th>${th("n", "Matchs")}${th("P", "Points")}${th("F", "Fautes")}${th("diff", "+/−")}
            ${["service", "reception", "passe", "attaque"].map((k) => th(k, C.SKILL[k].label))}</tr></thead>
          <tbody>${rows.map((r) => html`<tr key=${r.p.id} class=${who === r.p.id ? "hl" : ""}>
            <th scope="row" class="left"><button class="linkish" onClick=${() => setWho(r.p.id)}>${r.p.name}</button>${q.posteLabel(r.p.id) ? html`<small>${q.posteLabel(r.p.id)}</small>` : null}</th>
            <td>${r.n}</td><td><b>${r.P}</b></td><td>${r.F}</td><td><span class=${cx("diff-n", r.diff > 0 && "pos", r.diff < 0 && "neg")}>${signed(r.diff)}</span></td>
            ${["service", "reception", "passe", "attaque"].map((k) => html`<td key=${k}>${r.rates[k].total ? html`<${RateChip} r=${r.rates[k]} compact /><small>${r.rates[k].ok}/${r.rates[k].total}</small>` : html`<span class="muted">–</span>`}</td>`)}
          </tr>`)}</tbody>
        </table></div>
        <p class="muted small">Taux pondérés par le nombre de gestes sur toute la saison. Touche un nom pour suivre un joueur.</p>`}
      </section>

      ${who !== "team" && html`<section class="card">
        <h2 class="h-sec">Bilans de ${q.name(who)} au fil des matchs</h2>
        ${!perso.length ? html`<p class="muted">Aucun bilan écrit pour l’instant.</p>` : html`<ol class="timeline">
          ${perso.map(({ m, d }) => html`<li key=${m.id}><h3>${m.opponent} <small>${fmtDate(m.date)}</small></h3>
            ${d.bilan.pp && html`<p><span class="tag plus">+</span>${d.bilan.pp}</p>`}${d.bilan.pm && html`<p><span class="tag minus">−</span>${d.bilan.pm}</p>`}</li>`)}
        </ol>`}
      </section>`}
    </div>`;
  }

  /* ---------- Import d’un Excel ---------- */
  function ImportSheet({ onDone }) {
    const [state, setState] = useState({ step: "pick" });
    const [opp, setOpp] = useState("");
    const [date, setDate] = useState("");
    const [ra, setRa] = useState("");
    const [ro, setRo] = useState("");
    const onFile = async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      setState({ step: "reading", file: file.name });
      try {
        const res = await root.StatorIO.readWorkbookFile(file);
        if (!res.players.length) { setState({ step: "pick", error: "Aucune feuille joueur reconnue. Le fichier doit suivre le modèle ASVP (« Services » en B3, « Attaques » en B24)." }); return; }
        setOpp(res.opponent); setState({ step: "preview", file: file.name, res });
      } catch (err) {
        setState({ step: "pick", error: "Lecture impossible : vérifie qu’il s’agit d’un fichier .xlsx et que tu es connecté à Internet." });
      }
    };
    const doImport = () => {
      const res = state.res;
      const roster = q.roster().slice();
      const idOf = (name) => {
        const hit = roster.find((p) => C.norm(p.name) === C.norm(name));
        if (hit) return hit.id;
        let id = C.slug(name), k = 2;
        while (roster.some((p) => p.id === id)) id = C.slug(name) + "-" + k++;
        roster.push({ id, name: String(name).trim(), active: true });
        return id;
      };
      const ids = res.players.map((p) => idOf(p.name));
      const cfg = Object.assign({ team: "ASVP" }, store.config || {}, { roster });
      if (!cfg.season && date) cfg.season = C.seasonOf(date);
      api.saveConfig(cfg);
      const a = parseInt(ra, 10), o = parseInt(ro, 10);
      const m = { id: C.uid("m-"), opponent: opp.trim() || "Adversaire", date, venue: "", competition: "", sets: [],
        result: Number.isFinite(a) && Number.isFinite(o) ? { a, o } : null, createdAt: new Date().toISOString(), source: "Import " + state.file };
      api.saveMatch(m);
      res.players.forEach((p, i) => {
        if (!p.filled) return;
        api.saveStats({ id: C.statId(m.id, ids[i]), matchId: m.id, playerId: ids[i], sets: p.sets, bilan: p.bilan, updatedAt: new Date().toISOString() }, true);
      });
      onDone(m);
    };
    if (state.step !== "preview") {
      return html`<div class="import">
        <p>Choisis un fichier Excel de match au format de l’équipe (une feuille par joueur). Les stats et les bilans sont repris, y compris ceux écrits directement dans la feuille BILAN.</p>
        <label class="file-drop" for="imp-file"><${Icon} name="up" /><span>${state.step === "reading" ? "Lecture de " + state.file + "…" : "Choisir un fichier .xlsx"}</span></label>
        <input id="imp-file" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange=${onFile} class="sr-only" />
        ${state.error && html`<p class="form-err" role="alert">${state.error}</p>`}
      </div>`;
    }
    const res = state.res;
    const filled = res.players.filter((p) => p.filled);
    const known = q.roster();
    const fresh = res.players.filter((p) => !known.some((k) => C.norm(k.name) === C.norm(p.name)));
    const dup = q.matchList().find((m) => C.norm(m.opponent) === C.norm(opp));
    return html`<div class="import">
      <p class="muted small">Fichier : ${state.file}</p>
      <div class="field"><label for="imp-opp"><b>Adversaire</b></label><input id="imp-opp" value=${opp} onInput=${(e) => setOpp(e.target.value)} /></div>
      <div class="field-row">
        <div class="field"><label for="imp-date"><b>Date du match</b><small>Absente du fichier</small></label><input id="imp-date" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /></div>
        <div class="field"><span class="lbl"><b>Résultat en sets</b><small>Facultatif</small></span>
          <div class="res-inputs"><span>ASVP</span><input id="imp-ra" inputmode="numeric" aria-label="Sets gagnés par ASVP" value=${ra} onInput=${(e) => setRa(e.target.value.replace(/[^0-3]/g, "").slice(0, 1))} /><span>–</span><input id="imp-ro" inputmode="numeric" aria-label="Sets gagnés par l’adversaire" value=${ro} onInput=${(e) => setRo(e.target.value.replace(/[^0-3]/g, "").slice(0, 1))} /></div></div>
      </div>
      <h3 class="h-sub">${plural(filled.length, "joueur avec des stats", "joueurs avec des stats")} sur ${res.players.length}</h3>
      <ul class="imp-list">${filled.map((p) => html`<li key=${p.sheet}><b>${p.name}</b><span>${plural(p.actions, "action", "actions")}${C.hasBilan(p) ? " · bilan" : ""}</span></li>`)}</ul>
      ${fresh.length ? html`<p class="muted small">Ajoutés à l’effectif : ${fresh.map((p) => p.name).join(", ")}.</p>` : null}
      ${dup ? html`<p class="warn small">Un match contre ${dup.opponent} existe déjà (${fmtDate(dup.date)}). L’import en créera un second.</p>` : null}
      <div class="row-btns end"><button class="btn primary" onClick=${doImport}>Importer le match</button></div>
    </div>`;
  }

  /* ---------- Équipe : effectif, postes, données ---------- */
  function Team({ go, openSheet, me }) {
    const [newName, setNewName] = useState("");
    const cfg = store.config || { team: "ASVP", roster: [] };
    const roster = q.roster();
    const ro = store.readOnly;
    const save = (patch) => api.saveConfig(Object.assign({}, cfg, patch));
    const rename = (id, name) => { if (!name.trim()) return; save({ roster: roster.map((p) => (p.id === id ? Object.assign({}, p, { name: name.trim() }) : p)) }); };
    const toggle = (id) => save({ roster: roster.map((p) => (p.id === id ? Object.assign({}, p, { active: p.active === false }) : p)) });
    const add = (e) => {
      e.preventDefault();
      const name = newName.trim();
      if (!name) return;
      let id = C.slug(name), k = 2;
      while (roster.some((p) => p.id === id)) id = C.slug(name) + "-" + k++;
      save({ roster: roster.concat([{ id, name, active: true }]) });
      setNewName("");
    };
    const setPoste = (id, poste) => save({ roster: roster.map((p) => (p.id === id ? Object.assign({}, p, { poste }) : p)) });
    return html`<div class="page">
      <span class="eyebrow">Équipe</span>
      <h1 class="h-page">Effectif et réglages</h1>
      <div class="team-grid">
      <section class="card">
        <h2 class="h-sec">Effectif · ${plural(q.active().length, "joueur", "joueurs")}</h2>
        <ul class="roster">
          ${roster.map((p) => html`<li key=${p.id} class=${p.active === false ? "off" : ""}>
            <input id=${"r-" + p.id} aria-label=${"Nom de " + p.name} value=${p.name} disabled=${ro} onChange=${(e) => rename(p.id, e.target.value)} />
            <select id=${"rp-" + p.id} class="poste-sel" aria-label=${"Poste de " + p.name} value=${p.poste || ""} disabled=${ro} onChange=${(e) => setPoste(p.id, e.target.value)}>
              <option value="">Poste…</option>
              ${C.ROLES.map((r) => html`<option key=${r.k} value=${r.k}>${r.label}</option>`)}
            </select>
            ${p.id === me && html`<span class="chip done">toi</span>`}
            <button class="btn ghost sm" disabled=${ro} onClick=${() => toggle(p.id)}>${p.active === false ? "Réintégrer" : "Retirer"}</button>
          </li>`)}
        </ul>
        ${!ro && html`<form class="add-row" onSubmit=${add}>
          <input id="r-new" value=${newName} onInput=${(e) => setNewName(e.target.value)} placeholder="Nom du joueur" aria-label="Nom du nouveau joueur" />
          <button class="btn dark sm" type="submit"><${Icon} name="plus" size=${16} />Ajouter</button>
        </form>`}
        <p class="muted small">Un joueur retiré garde ses stats passées ; il n’apparaît plus dans les nouveaux matchs.</p>
      </section>

      <div class="col">
      <section class=${cx("card", "mode-card", store.mode)}>
        <h2 class="h-sec">${store.mode === "local" ? "Mode hors ligne" : "Base de l’équipe"}</h2>
        <p>${store.mode === "local"
          ? "Les saisies restent sur cet appareil. Utilise l’export Excel pour les transmettre."
          : ro ? "Tu consultes les stats en lecture seule. Pour saisir, le propriétaire de l’app doit t’inviter comme éditeur."
          : "Chaque saisie est enregistrée tout de suite et visible par toute l’équipe. Rien à envoyer, rien à fusionner."}</p>
      </section>
      <section class="card">
        <h2 class="h-sec">Données</h2>
        <div class="row-btns">
          ${!ro && html`<button class="btn ghost" onClick=${() => openSheet({ type: "import" })}><${Icon} name="up" size=${18} />Importer un Excel de match</button>`}
          <button class="btn ghost" onClick=${() => go({ view: "season" })}><${Icon} name="down" size=${18} />Exporter la saison (onglet Saison)</button>
        </div>
      </section>
      </div>
      </div>
    </div>`;
  }

  root.StatorSeason = { Season, Team, ImportSheet };
})(window);
