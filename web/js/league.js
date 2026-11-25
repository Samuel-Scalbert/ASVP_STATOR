/* ASVP Stator — championnat FFVolley : classement, journées et fiche de chaque équipe.
   Les données viennent du site de la fédération (stator/ffvb.py). Seuls les matchs de la poule et leurs
   scores sont stockés : le classement, les statistiques et les points à retenir sur chaque adversaire sont
   recalculés ici à chaque affichage. */
(function (root) {
  "use strict";
  const { html, useState, useEffect } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, cx, plural, fmtDate, fmtTime, TeamLogo } = U;

  /* ---------- Calculs ---------- */
  const isPlayed = (m) => m.sets.length > 0;
  const byDate = (a, b) => ((a.date || "9999") + a.time).localeCompare((b.date || "9999") + b.time) || a.code.localeCompare(b.code);
  const points = (won, lost) => (won > lost ? (lost <= 1 ? 3 : 2) : won === 2 ? 1 : 0);
  const ratio = (a, b) => (b ? a / b : a ? Infinity : 0);
  /* Un match vu par une équipe : adversaire, scores des sets dans son sens, sets gagnés et perdus. */
  function side(m, team) {
    const home = m.home === team;
    const sets = m.sets.map(([h, a]) => (home ? [h, a] : [a, h]));
    return { m, home, opp: home ? m.away : m.home, sets, won: sets.filter(([x, y]) => x > y).length, lost: sets.filter(([x, y]) => y > x).length };
  }
  /* Classement : points (barème FFVolley et écarts officiels), puis victoires, ratio des sets, ratio des points. */
  function table(matches, adjust) {
    const rows = {};
    const row = (t) => rows[t] || (rows[t] = { team: t, pts: 0, j: 0, v: 0, d: 0, sw: 0, sl: 0, pw: 0, pl: 0, form: [], pen: 0 });
    matches.forEach((m) => { row(m.home); row(m.away); });
    matches.filter(isPlayed).sort(byDate).forEach((m) => {
      [m.home, m.away].forEach((t) => {
        const s = side(m, t), r = row(t);
        r.j++;
        if (s.won > s.lost) r.v++; else r.d++;
        r.pts += points(s.won, s.lost);
        r.sw += s.won; r.sl += s.lost;
        s.sets.forEach(([x, y]) => { r.pw += x; r.pl += y; });
        r.form.push(s);
      });
    });
    Object.keys(adjust || {}).forEach((t) => { row(t).pts += adjust[t]; row(t).pen = adjust[t]; });
    const list = Object.values(rows);
    list.forEach((r) => { r.sr = ratio(r.sw, r.sl); r.pr = ratio(r.pw, r.pl); });
    list.sort((x, y) => y.pts - x.pts || y.v - x.v || y.sr - x.sr || y.pr - x.pr || x.team.localeCompare(y.team));
    list.forEach((r, i) => { r.rank = i + 1; });
    return list;
  }
  const current = () => (store.league ? table(store.league.matches, store.league.adjust) : []);
  /* Les matchs de notre équipe dans la poule, dans l’ordre du calendrier. */
  function ourFixtures() {
    const L = store.league;
    return L ? L.matches.filter((m) => m.home === L.team || m.away === L.team).sort(byDate) : [];
  }
  /* Le match de l’app qui correspond à un match de la poule : créé depuis celui-ci, ou le même jour. */
  function appMatchFor(f) {
    const list = q.matchList();
    return list.find((m) => m.id === "m-" + f.code.toLowerCase()) || (f.date ? list.find((m) => m.date === f.date) : null) || null;
  }
  /* Score officiel d’un match de l’app (vu par notre équipe), s’il est connu du championnat. */
  function officialFor(m) {
    const L = store.league;
    if (!L || !m.date) return null;
    const f = L.matches.find((x) => isPlayed(x) && (m.id === "m-" + x.code.toLowerCase() || x.date === m.date) && (x.home === L.team || x.away === L.team));
    if (!f) return null;
    const s = side(f, L.team);
    return { code: f.code, sets: s.sets.map(([a, o]) => ({ a, o })), result: { a: s.won, o: s.lost } };
  }
  /* Le match de la poule (joué ou non) qui correspond à un match de l’app. */
  function fixtureFor(m) {
    const L = store.league;
    if (!L) return null;
    return L.matches.find((x) => (m.id === "m-" + x.code.toLowerCase() || (m.date && x.date === m.date)) && (x.home === L.team || x.away === L.team)) || null;
  }
  /* Pour la page d’un match à venir : salle et adresse, maillots, classement et forme de l’adversaire. */
  function fixtureInfo(m) {
    const L = store.league, f = fixtureFor(m);
    if (!L || !f) return null;
    const s = side(f, L.team), rows = table(L.matches, L.adjust), r = rows.find((x) => x.team === s.opp);
    const teams = L.teams || {}, gymAddr = f.gym ? (L.gyms || {})[f.gym] : "";
    const last = r && r.form.length ? r.form[r.form.length - 1] : null;
    const vs = (ms) => ms.filter((x) => isPlayed(x) && [x.home, x.away].includes(s.opp) && [x.home, x.away].includes(L.team)).sort(byDate).map((x) => side(x, L.team));
    const h2hText = (list) => list.map((x) => `${x.won > x.lost ? "victoire" : "défaite"} ${x.won}–${x.lost}`).join(", ");
    const now = vs(L.matches), prev = L.previous ? vs(L.previous.matches) : [];
    const fix = f.fix || {};
    return {
      fixture: f, meet: fix.meet || "", note: fix.note || "", ffvb: ffvbText(f),
      code: f.code, round: f.round, title: niceTitle(L.title), team: s.opp,
      gym: f.gym ? { name: nice(f.gym), address: gymAddr ? nice(gymAddr) : "", maps: mapsUrl(f.gym, gymAddr || "Paris") } : null,
      ourColors: (teams[L.team] || {}).colors || "", theirColors: (teams[s.opp] || {}).colors || "",
      rank: r ? r.rank : 0, teams: rows.length, pts: r ? r.pts : 0, v: r ? r.v : 0, d: r ? r.d : 0, sw: r ? r.sw : 0, sl: r ? r.sl : 0,
      last: last ? `${last.won > last.lost ? "victoire" : "défaite"} ${last.won}–${last.lost} contre ${last.opp}` : "",
      h2h: [now.length ? "cette saison " + h2hText(now) : "", prev.length ? "saison " + L.previous.season + " " + h2hText(prev) : ""].filter(Boolean).join(" · "),
    };
  }
  /* Ce que le site FFVolley indique encore, quand l’équipe a corrigé la date, l’heure ou la salle. */
  function ffvbText(f) {
    const was = f.ffvb;
    if (!was) return "";
    return [("date" in was ? (was.date ? fmtDate(was.date, { weekday: "short", day: "numeric", month: "short" }) : "date à fixer") : ""),
      ("time" in was && was.time ? fmtTime(was.time) : ""), ("gym" in was && was.gym ? nice(was.gym) : "")].filter(Boolean).join(" · ");
  }
  /* Correction d’un match de la poule : seules la date, l’heure et la salle qui diffèrent du site comptent. */
  function fixOf(f) {
    const was = f.ffvb || {}, fix = f.fix || {}, out = { meet: fix.meet || "", note: fix.note || "" };
    if ("date" in was) out.date = f.date;
    if ("time" in was) out.time = f.time;
    if ("gym" in was) { out.gym = f.gym; out.address = (store.league.gyms || {})[f.gym] || ""; }
    return out;
  }
  const siteValue = (f, k) => (f.ffvb && k in f.ffvb ? f.ffvb[k] : f[k] || "");
  /* Enregistre la correction (changes à null : on revient aux infos du site) et, si le match existe dans
     l’app, y reporte la date et l’heure. */
  async function saveFix(f, changes, syncApp) {
    const doc = changes ? Object.assign(fixOf(f), changes) : {};
    if (doc.date === siteValue(f, "date")) delete doc.date;
    if (doc.time === siteValue(f, "time")) delete doc.time;
    if (doc.gym != null && C.norm(doc.gym) === C.norm(siteValue(f, "gym"))) { delete doc.gym; delete doc.address; }
    Object.keys(doc).forEach((k) => { if (!doc[k]) delete doc[k]; });
    const app = syncApp ? appMatchFor(f) : null;
    const err = await api.saveLeagueFix(f.code, doc);
    if (err) return err;
    const g = store.league.matches.find((x) => x.code === f.code);
    if (app && g && !isPlayed(g) && (app.date !== g.date || (app.time || "") !== g.time)) {
      api.saveMatch(Object.assign({}, app, { date: g.date, time: g.time, updatedAt: new Date().toISOString() }));
    }
    return "";
  }
  /* Formulaire « Corriger les infos » d’un match de la poule (horaire ou salle changés, rendez-vous). */
  function FixtureFix({ f, onDone }) {
    const L = store.league, cur = fixOf(f);
    const [date, setDate] = useState(f.date || "");
    const [time, setTime] = useState(f.time || "");
    const [meet, setMeet] = useState(cur.meet);
    const [gym, setGym] = useState(f.gym ? (cur.gym ? f.gym : nice(f.gym)) : "");
    const [address, setAddress] = useState(cur.address || "");
    const [note, setNote] = useState(cur.note);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const site = [siteValue(f, "date") ? fmtDate(siteValue(f, "date"), { weekday: "long", day: "numeric", month: "long" }) : "date à fixer",
      siteValue(f, "time") ? fmtTime(siteValue(f, "time")) : "", siteValue(f, "gym") ? nice(siteValue(f, "gym")) : ""].filter(Boolean).join(" · ");
    const newGym = !!gym.trim() && C.norm(gym) !== C.norm(siteValue(f, "gym"));
    const run = async (changes) => {
      setBusy(true);
      const e = await saveFix(f, changes, true);
      setBusy(false);
      if (e) setErr(e); else onDone(changes);
    };
    const submit = (e) => {
      e.preventDefault();
      if (!date) { setErr("Indique la date du match."); return; }
      run({ date, time, meet, note: note.trim(), gym: newGym ? gym.trim() : "", address: newGym ? address.trim() : "" });
    };
    return html`<form class="form" onSubmit=${submit}>
      <p class="muted small">Pour un changement annoncé par le coach que le site FFVolley n’affiche pas encore. La correction reste en place à chaque actualisation du championnat ; dès que le site affiche la même date, la même heure et la même salle, elle s’efface toute seule.</p>
      <p class="small">Site FFVolley : <b>${site}</b></p>
      <div class="field-row">
        <div class="field"><label for="fx-date"><b>Date</b></label><input id="fx-date" type="date" value=${date} onInput=${(e) => { setDate(e.target.value); setErr(""); }} /></div>
        <div class="field"><label for="fx-time"><b>Début du match</b></label><input id="fx-time" type="time" value=${time} onInput=${(e) => setTime(e.target.value)} /></div>
        <div class="field"><label for="fx-meet"><b>Rendez-vous</b><small>Facultatif</small></label><input id="fx-meet" type="time" value=${meet} onInput=${(e) => setMeet(e.target.value)} /></div>
      </div>
      <div class="field"><label for="fx-gym"><b>Salle</b></label><input id="fx-gym" value=${gym} onInput=${(e) => { setGym(e.target.value); setErr(""); }} placeholder="Ex. : Centre sportif Léon Biancotto" autocomplete="off" /></div>
      ${newGym ? html`<div class="field"><label for="fx-addr"><b>Adresse de la salle</b><small>Pour le bouton Itinéraire</small></label><input id="fx-addr" value=${address} onInput=${(e) => setAddress(e.target.value)} placeholder="Ex. : 8 av. de la Porte de Clichy, 75017 Paris" autocomplete="off" /></div>` : null}
      <div class="field"><label for="fx-note"><b>Message pour l’équipe</b><small>Facultatif</small></label><textarea id="fx-note" rows="2" maxlength="300" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="Ex. : changement de lieu et d’horaire"></textarea></div>
      ${err && html`<p class="form-err" role="alert">${err}</p>`}
      <div class="row-btns end">
        ${f.fix ? html`<button type="button" class="btn ghost" disabled=${busy} onClick=${() => run(null)}>Revenir aux infos du site</button>` : null}
        <button class="btn primary" type="submit" disabled=${busy}>Enregistrer</button>
      </div>
    </form>`;
  }

  /* Crée dans l’app le match d’une journée, pour y saisir les stats (identifiant fixe : pas de doublon). */
  function createFromFixture(f) {
    const L = store.league, s = side(f, L.team), now = new Date().toISOString();
    const doc = {
      id: "m-" + f.code.toLowerCase(), opponent: s.opp, date: f.date, time: f.time || "", venue: s.home ? "dom" : "ext",
      competition: "Départementale", sets: s.sets.map(([a, o]) => ({ a, o })), result: null, noData: false,
      videoKind: "", video: "", videoNote: "", squad: [], closed: false, source: "FFVolley " + f.code, createdAt: now, updatedAt: now,
    };
    api.saveMatch(doc);
    return doc;
  }

  /* ---------- Mise en forme ---------- */
  const ordinal = (n) => (n === 1 ? "1er" : n + "ᵉ");
  const fmtRatio = (r) => (r === Infinity ? "MAX" : r.toFixed(2).replace(".", ","));
  const SMALL = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "sur", "aux", "au"]);
  /* Les textes du site sont en majuscules : « 29 RUE DE LA LANCETTE » -> « 29 Rue de la Lancette ». */
  const nice = (s) => (s || "").toLowerCase().split(" ").map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
  const ACCENTS = { regionale: "régionale", regional: "régional", departementale: "départementale", departemental: "départemental", feminine: "féminine", feminin: "féminin" };
  const niceTitle = (t) => nice((t || "").replace(/^\S+\s+-\s+/, "")).replace(/\b(Regionale?|Departementale?|Feminine?)\b/gi, (w) => {
    const v = ACCENTS[w.toLowerCase()] || w;
    return w.charAt(0) === w.charAt(0).toUpperCase() ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  });
  const poolUrl = (src) => "https://www.ffvbbeach.org/ffvbapp/resu/vbspo_calendrier.php?saison=" + encodeURIComponent(src.season)
    + "&codent=" + encodeURIComponent(src.codent) + "&poule=" + encodeURIComponent(src.poule);
  const mapsUrl = (gym, address) => "https://www.google.com/maps/search/?api=1&query="
    + encodeURIComponent([/gymnase|centre|stade|salle|complexe|halle|palais/i.test(gym) ? nice(gym) : "Gymnase " + nice(gym), nice(address)].filter(Boolean).join(", "));
  const when = (m, opts) => (m.date ? fmtDate(m.date, opts || { weekday: "short", day: "numeric", month: "short" }) : "Date à fixer") + (m.time ? " · " + fmtTime(m.time) : "");
  const setsText = (sets) => sets.map(([a, b]) => a + "-" + b).join(", ");
  function updatedText(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function daysUntil(day) {
    const [y, mo, d] = day.split("-").map(Number), [ty, tmo, td] = C.todayIso().split("-").map(Number);
    return Math.round((new Date(y, mo - 1, d) - new Date(ty, tmo - 1, td)) / 864e5);
  }
  function Form({ list }) {
    return html`<span class="form-dots" aria-label=${list.map((s) => (s.won > s.lost ? "victoire" : "défaite")).join(", ") || "aucun match"}>
      ${list.slice(-5).map((s, i) => html`<i key=${i} class=${s.won > s.lost ? "v" : "d"} title=${s.won + "–" + s.lost + " contre " + s.opp}>${s.won > s.lost ? "V" : "D"}</i>`)}
    </span>`;
  }
  /* Résultat d’une équipe dans un match, avec le détail des sets. */
  function ResultLine({ s, onTeam, openSheet }) {
    const w = s.won > s.lost;
    return html`<li class="tm-line">
      <span class="tl-when">${when(s.m)}<small>${s.home ? "Domicile" : "Extérieur"}</small></span>
      <span class="tl-opp"><${TeamLogo} name=${s.opp} />${onTeam ? html`<button class="linkish" onClick=${() => onTeam(s.opp)}>${s.opp}</button>` : s.opp}</span>
      <span class=${cx("res", w ? "win" : "loss")}>${w ? "V" : "D"} ${s.won}–${s.lost}</span>
      <span class="tl-sets">${setsText(s.sets)} <${SheetPill} code=${s.m.code} openSheet=${openSheet} /></span>
    </li>`;
  }

  /* ---------- Page « Classement » ---------- */
  function StandingsTable({ rows, us, onTeam, compact }) {
    return html`<div class="table-scroll"><table class=${cx("standings", compact && "compact")}>
      <thead><tr>
        <th class="st-rank" scope="col">#</th><th class="st-team" scope="col">Équipe</th><th scope="col">Pts</th>
        <th scope="col" title="Matchs joués">J</th><th scope="col" title="Victoires">V</th><th scope="col" title="Défaites">D</th>
        <th scope="col" title="Sets gagnés – perdus">Sets</th>${compact ? null : html`<th class="opt" scope="col" title="Sets gagnés / sets perdus">Ratio</th>
        <th class="opt" scope="col" title="Points marqués – encaissés">Points</th><th class="opt" scope="col" title="Points marqués / points encaissés">Ratio</th>
        <th scope="col">Forme</th>`}
      </tr></thead>
      <tbody>${rows.map((r) => html`<tr key=${r.team} class=${cx(r.team === us && "us")} onClick=${onTeam ? () => onTeam(r.team) : null}>
        <td class="st-rank">${r.rank}</td>
        <td class="st-team"><${TeamLogo} name=${r.team} />${onTeam ? html`<button class="linkish" onClick=${(e) => { e.stopPropagation(); onTeam(r.team); }}>${r.team}</button>` : r.team}${r.pen ? html`<small class="st-pen" title="Écart avec le barème : forfait ou pénalité">${r.pen > 0 ? "+" : ""}${r.pen} pt</small>` : null}</td>
        <td class="st-pts">${r.pts}</td><td>${r.j}</td><td>${r.v}</td><td>${r.d}</td><td>${r.sw}–${r.sl}</td>
        ${compact ? null : html`<td class="opt">${fmtRatio(r.sr)}</td><td class="opt">${r.pw}–${r.pl}</td><td class="opt">${fmtRatio(r.pr)}</td>
        <td><${Form} list=${r.form} /></td>`}
      </tr>`)}</tbody>
    </table></div>`;
  }
  function Rounds({ L, onTeam, openSheet }) {
    const today = C.todayIso();
    const rounds = Array.from(new Set(L.matches.map((m) => m.round))).sort((a, b) => a - b);
    const coming = L.matches.filter((m) => !isPlayed(m) && m.date >= today).sort(byDate)[0];
    const [r, setR] = useState(coming ? coming.round : rounds[rounds.length - 1]);
    const i = rounds.indexOf(r);
    const list = L.matches.filter((m) => m.round === r).sort(byDate);
    const teams = Array.from(new Set(L.matches.flatMap((m) => [m.home, m.away])));
    const exempt = teams.filter((t) => !list.some((m) => m.home === t || m.away === t));
    return html`<section class="card">
      <div class="block-head">
        <h2 class="h-sec">Journée ${r}</h2>
        <div class="cal-nav">
          <button type="button" class="icon-btn" disabled=${i <= 0} onClick=${() => setR(rounds[i - 1])} aria-label="Journée précédente"><${Icon} name="back" size=${18} /></button>
          <span class="cal-month">${i + 1} / ${rounds.length}</span>
          <button type="button" class="icon-btn" disabled=${i >= rounds.length - 1} onClick=${() => setR(rounds[i + 1])} aria-label="Journée suivante"><${Icon} name="next" size=${18} /></button>
        </div>
      </div>
      <ul class="round-list">${list.map((m) => {
        const [h, a] = [side(m, m.home).won, side(m, m.away).won];
        return html`<li key=${m.code} class=${cx((m.home === L.team || m.away === L.team) && "us")}>
          <span class="rl-when">${when(m)}</span>
          <span class="rl-teams"><${TeamLogo} name=${m.home} /><button class="linkish" onClick=${() => onTeam(m.home)}>${m.home}</button><i>–</i><${TeamLogo} name=${m.away} /><button class="linkish" onClick=${() => onTeam(m.away)}>${m.away}</button></span>
          <span class="rl-score">${isPlayed(m) ? html`<b>${h}–${a}</b><small>${setsText(m.sets)}</small><${SheetPill} code=${m.code} openSheet=${openSheet} />` : html`<small>${m.gym ? nice(m.gym) : ""}</small>`}</span>
        </li>`;
      })}</ul>
      ${exempt.length ? html`<p class="muted small">Exempt : ${exempt.join(", ")}.</p>` : null}
    </section>`;
  }
  function Standings({ openSheet }) {
    const L = store.league;
    if (!L) {
      return html`<div class="page"><h1 class="h-page">Classement</h1><section class="card empty-state">
        <h2 class="h-sec">Pas encore de résultats</h2>
        <p>Le classement vient du site de la FFVolley. Il est mis à jour automatiquement chaque matin, ou à la demande (voir le Tuto, « Questions fréquentes »).</p>
      </section></div>`;
    }
    const rows = table(L.matches, L.adjust);
    const onTeam = (team) => openSheet({ type: "team", team });
    const next = ourFixtures().find((m) => !isPlayed(m) && m.date >= C.todayIso());
    const prev = L.previous ? table(L.previous.matches, L.previous.adjust) : null;
    const opp = next && side(next, L.team).opp, oppRow = opp && rows.find((r) => r.team === opp);
    return html`<div class="page wide">
      <div class="page-head">
        <div><h1 class="h-page">Classement</h1><p class="muted">${niceTitle(L.title)} · saison ${L.source.season}</p></div>
        <a class="btn ghost sm" href=${poolUrl(L.source)} target="_blank" rel="noopener noreferrer">Site FFVolley<${Icon} name="next" size=${14} /></a>
      </div>
      ${next && html`<section class="next-banner">
        <span class="eyebrow">Prochain match · ${when(next, { weekday: "long", day: "numeric", month: "long" })}</span>
        <div class="nb-main"><b><${TeamLogo} name=${next.home} size=${28} />${next.home} – <${TeamLogo} name=${next.away} size=${28} />${next.away}</b>${oppRow ? html`<span class="rank-chip">${opp} : ${ordinal(oppRow.rank)} au classement</span>` : null}</div>
        <button class="btn primary sm" onClick=${() => onTeam(opp)}>Fiche de l’adversaire</button>
      </section>`}
      <section class="card table-card">
        <${StandingsTable} rows=${rows} us=${L.team} onTeam=${onTeam} />
        <p class="muted small table-foot">Mis à jour ${updatedText(L.updatedAt)} depuis le site de la FFVolley. Clique sur une équipe pour voir sa fiche.</p>
      </section>
      <${Rounds} L=${L} onTeam=${onTeam} openSheet=${openSheet} />
      ${prev && html`<details class="card prev-season"><summary><b>Saison ${L.previous.season}</b> : classement final</summary>
        <${StandingsTable} rows=${prev} us=${L.team} compact /></details>`}
    </div>`;
  }

  const canFix = () => store.mode === "api" && !store.readOnly;

  /* ---------- Feuille de match (lue sur le site FFVolley après le match) ---------- */
  const hasSheet = (code) => !!(store.league && (store.league.sheets || []).includes(code));
  /* Code du match de la poule dont la feuille est lue, pour un match de l’app. */
  function sheetCodeFor(m) {
    const f = fixtureFor(m);
    return f && hasSheet(f.code) ? f.code : "";
  }
  /* Pastille : la feuille de match de ce match a été lue ; un clic l’ouvre. */
  function SheetPill({ code, openSheet, band }) {
    if (!code || !hasSheet(code) || !openSheet) return null;
    return html`<button type="button" class=${cx("sheet-pill", band && "band")} title="Infos d’après-match lues sur la feuille de match FFVolley"
      onClick=${(e) => { e.stopPropagation(); openSheet({ type: "fdme", code }); }}><${Icon} name="list" size=${13} />Feuille de match</button>`;
  }
  const fdmeUrl = (src, code) => "https://www.ffvbbeach.org/ffvbapp/resu/ffvolley_fdme.php?saison=" + encodeURIComponent(src.season)
    + "&codent=" + encodeURIComponent(src.codent) + "&codmatch=" + encodeURIComponent(code);
  const STAFF = { E: "Entraîneur", EA: "Entraîneur adjoint" };
  const realMin = (n) => n >= 8; // la feuille est souvent remplie après le match : horaires sans valeur
  const fmtMin = (n) => (n >= 60 ? Math.floor(n / 60) + " h " + String(n % 60).padStart(2, "0") : n + " min");
  function Roster({ name, r, unknown }) {
    const off = new Set((unknown || []).map((u) => u.num));
    return html`<section class="fd-roster">
      <h3 class="h-sub"><${TeamLogo} name=${name} size=${22} />${name}<small>${plural(r.players.length, "joueur", "joueurs")}</small></h3>
      <table class="fd-table"><thead><tr><th scope="col">N°</th><th scope="col">Nom</th><th scope="col">Licence</th></tr></thead>
        <tbody>${r.players.map((p) => html`<tr key=${p.num + p.lic}><td class="fd-num">${p.num}</td>
          <td>${nice(p.name)}${p.libero ? html` <span class="fd-lib" title="Libéro">Libéro</span>` : null}${off.has(p.num) ? html` <span class="fd-unk" title="Pas reconnu dans l’effectif de l’app">pas dans l’effectif</span>` : null}</td><td class="fd-lic">${p.lic}</td></tr>`)}</tbody></table>
      ${r.staff.length ? html`<p class="small fd-staff">${r.staff.map((x) => html`<span key=${x.role + x.lic}>${STAFF[x.role] || x.role} : <b>${nice(x.name)}</b>${x.lic ? html` <small>(licence ${x.lic})</small>` : null}</span>`)}</p>` : null}
    </section>`;
  }
  function MatchSheet({ code }) {
    const L = store.league;
    const [d, setD] = useState(null);
    const [err, setErr] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    useEffect(() => {
      let on = true;
      fetch("api/league/sheets/" + encodeURIComponent(code), { headers: { Accept: "application/json" } })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((x) => { if (on) setD(x); }, () => { if (on) setErr("Feuille de match introuvable pour l’instant."); });
      return () => { on = false; };
    }, [code]);
    if (err) return html`<p class="muted">${err}</p>`;
    if (!d) return html`<p class="muted">Chargement de la feuille de match…</p>`;
    const us = L ? L.team : "", ours = d.b === us ? "b" : "a", theirs = ours === "a" ? "b" : "a";
    const timed = d.sets.some((s) => realMin(s.min));
    const extra = d.sets.some((s) => s.a.to || s.b.to || s.a.subs || s.b.subs);
    const won = (t) => d.sets.filter((s) => s[t].pts > s[t === "a" ? "b" : "a"].pts).length;
    const sq = d.squad, unknown = sq ? sq.unknown : [];
    const app = sq && store.matches[sq.match];
    const resync = async () => {
      setBusy(true);
      const r = await api.applySheetSquad(code);
      setBusy(false);
      if (r.error) { setMsg(r.error); return; }
      setD(Object.assign({}, d, { squad: r.squad }));
      setMsg(plural(r.squad.players, C.g("joueur repris", "joueuse reprise"), C.g("joueurs repris", "joueuses reprises")) + " dans le match.");
    };
    return html`<div class="fd">
      <p class="fd-head"><b>${d[ours]} ${won(ours)}–${won(theirs)} ${d[theirs]}</b>
        <span class="muted">match ${code}${timed && d.start ? " · " + fmtTime(d.start) + " → " + fmtTime(d.end) + (d.min ? " · " + fmtMin(d.min) : "") : ""}</span></p>
      <div class="table-scroll"><table class="fd-table fd-sets">
        <thead><tr><th scope="col">Set</th><th scope="col">Score</th><th scope="col">Service en premier</th>
          ${timed ? html`<th scope="col">Horaires</th><th scope="col">Durée</th>` : null}
          ${extra ? html`<th scope="col">Temps morts</th><th scope="col">Remplacements</th>` : null}</tr></thead>
        <tbody>${d.sets.map((s) => html`<tr key=${s.n}>
          <td>Set ${s.n}</td>
          <td class=${cx("fd-score", s[ours].pts > s[theirs].pts ? "win" : "loss")}>${s[ours].pts}–${s[theirs].pts}</td>
          <td>${s.serve ? d[s.serve] : "–"}</td>
          ${timed ? html`<td>${realMin(s.min) && s.start ? fmtTime(s.start) + " → " + fmtTime(s.end) : "–"}</td><td>${realMin(s.min) ? s.min + " min" : "–"}</td>` : null}
          ${extra ? html`<td>${s[ours].to}–${s[theirs].to}</td><td>${s[ours].subs}–${s[theirs].subs}</td>` : null}
        </tr>`)}</tbody></table></div>
      ${timed ? null : html`<p class="muted small">Pas d’horaires exploitables : la feuille a été remplie après le match.</p>`}
      ${extra ? null : html`<p class="muted small">Aucun temps mort ni remplacement noté sur la feuille.</p>`}
      <section class="fd-squad">
        ${sq ? html`<p><b>${C.g("Joueurs du match", "Joueuses du match")} repris de la feuille</b>${app ? " (" + q.us() + " – " + app.opponent + ", " + fmtDate(app.date) + ")" : ""} : ${plural(sq.players, C.g("joueur", "joueuse"), C.g("joueurs", "joueuses"))}. Ce sont ${C.g("eux", "elles")} qui ont une fiche à remplir.</p>`
          : html`<p>Les ${C.g("joueurs", "joueuses")} de la feuille deviennent ${C.g("les joueurs", "les joueuses")} du match dès que le match existe dans l’app.</p>`}
        ${unknown.length ? html`<p class="warn small">Pas reconnus dans l’effectif : ${unknown.map((u) => "n°" + u.num + " " + nice(u.name)).join(", ")}. Ajoute-les dans l’onglet Équipe (prénom, puis l’initiale du nom si deux ont le même prénom), puis reprends la feuille.</p>` : null}
        ${canFix() ? html`<div class="row-btns"><button class="btn ghost sm" disabled=${busy} onClick=${resync}><${Icon} name="users" size=${15} />${busy ? "Mise à jour…" : "Reprendre les joueurs de la feuille"}</button>${msg ? html`<span class="small">${msg}</span>` : null}</div>` : null}
      </section>
      <div class="fd-rosters"><${Roster} name=${d[ours]} r=${d.rosters[ours]} unknown=${unknown} /><${Roster} name=${d[theirs]} r=${d.rosters[theirs]} /></div>
      <p class="muted small">Les six de départ, les sanctions et le capitaine ne sont pas repris ici : ils ne sont pas remplis sur les feuilles de cette poule. Ils restent visibles sur la feuille officielle.</p>
      ${L ? html`<a class="btn ghost sm" href=${fdmeUrl(L.source, code)} target="_blank" rel="noopener noreferrer">Feuille officielle (PDF)<${Icon} name="next" size=${14} /></a>` : null}
    </div>`;
  }
  /* Changement saisi par l’équipe : rendez-vous, message, et ce que le site FFVolley indique encore. */
  function FixNote({ f }) {
    const fix = f.fix || {}, was = ffvbText(f);
    return html`<div class="fix-note" role="note">
      <span class="fix-badge">Changement</span>
      <span>${fix.note ? html`<b>${fix.note}</b>` : null}${fix.meet ? html`${fix.note ? " · " : ""}Rendez-vous à <b>${fmtTime(fix.meet)}</b>` : null}
        ${was ? html`<small>Le site FFVolley indique encore : ${was}.</small>` : null}</span>
    </div>`;
  }

  /* SportEasy n’a pas la même date ou heure que l’app : on montre les deux et on demande laquelle garder. */
  function SeDateAsk({ f }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    if (!f || !f.se) return null;
    const txt = (d, t) => (d ? fmtDate(d, { weekday: "short", day: "numeric", month: "short" }) : "date à fixer") + (t ? " · " + fmtTime(t) : "");
    const pick = async (keep) => { setBusy(true); setErr(await api.chooseSeDate(f.code, keep)); setBusy(false); };
    return html`<div class="se-ask" role="group" aria-label="Date différente sur SportEasy">
      <span class="se-badge">SportEasy</span>
      <div>
        <p><b>Date différente sur SportEasy.</b> Laquelle est la bonne ?</p>
        <dl class="se-both"><div><dt>Dans l’app</dt><dd>${txt(f.date, f.time)}</dd></div><div><dt>Sur SportEasy</dt><dd>${txt(f.se.date, f.se.time)}</dd></div></dl>
        ${canFix() ? html`<div class="row-btns">
          <button class="btn ghost sm" disabled=${busy} onClick=${() => pick("app")}>Garder ${txt(f.date, f.time)}</button>
          <button class="btn primary sm" disabled=${busy} onClick=${() => pick("sporteasy")}>Prendre ${txt(f.se.date, f.se.time)}</button>
        </div>` : null}
        ${err ? html`<p class="form-err small">${err}</p>` : null}
      </div>
    </div>`;
  }

  /* ---------- Fiche d’une équipe (et de l’adversaire d’un prochain match) ---------- */
  function insights(team, games, L) {
    const out = [], played = games.filter(isPlayed).map((m) => side(m, team));
    const last = played[played.length - 1];
    if (last) out.push(`Dernier match : ${last.won > last.lost ? "victoire" : "défaite"} ${last.won}–${last.lost} contre ${last.opp} (${setsText(last.sets)}).`);
    // Matchs retournés : mené (ou menant) 2 sets à 0, puis l’inverse.
    played.forEach((s) => {
      const first2 = s.sets.slice(0, 2).filter(([a, b]) => a > b).length;
      if (first2 === 2 && s.won < s.lost) out.push(`A perdu contre ${s.opp} après avoir mené 2 sets à 0 : il ne faut rien lâcher.`);
      if (first2 === 0 && s.sets.length >= 2 && s.won > s.lost) out.push(`A gagné contre ${s.opp} après avoir été mené 2 sets à 0 : équipe qui revient.`);
    });
    const all = played.flatMap((s) => s.sets);
    const close = all.filter(([a, b]) => Math.abs(a - b) <= 2);
    const closeWon = close.filter(([a, b]) => a > b).length;
    if (close.length) out.push(`Sets serrés (2 points d’écart ou moins) : ${closeWon ? plural(closeWon, "gagné", "gagnés") : "aucun gagné"} sur ${close.length}.`);
    if (all.length) {
      const pf = all.reduce((x, [a]) => x + a, 0) / all.length, pa = all.reduce((x, [, b]) => x + b, 0) / all.length;
      out.push(`En moyenne par set : ${pf.toFixed(1).replace(".", ",")} points marqués, ${pa.toFixed(1).replace(".", ",")} encaissés.`);
    }
    if (L.previous && team !== L.team) {
      const prevRows = table(L.previous.matches, L.previous.adjust), pr = prevRows.find((r) => r.team === team);
      out.push(pr ? `Saison ${L.previous.season} : ${ordinal(pr.rank)} sur ${prevRows.length} (${pr.pts} pts, ${pr.v} V – ${pr.d} D).`
        : `Pas dans cette poule la saison ${L.previous.season} : nouvelle équipe pour nous.`);
    }
    return out;
  }
  function TeamSheet({ team, go, openSheet }) {
    const L = store.league;
    if (!L) return null;
    const us = L.team, isUs = team === us, today = C.todayIso();
    const rows = table(L.matches, L.adjust);
    const r = rows.find((x) => x.team === team);
    if (!r) return html`<p class="muted">Équipe inconnue dans ce championnat.</p>`;
    const info = (L.teams || {})[team] || {}, ourInfo = (L.teams || {})[us] || {};
    const games = L.matches.filter((m) => m.home === team || m.away === team).sort(byDate);
    const played = games.filter(isPlayed).map((m) => side(m, team));
    const coming = games.filter((m) => !isPlayed(m));
    const onTeam = (t) => openSheet({ type: "team", team: t });
    const vsUs = isUs ? [] : games.filter((m) => m.home === us || m.away === us);
    const prevVs = !isUs && L.previous ? L.previous.matches.filter((m) => isPlayed(m) && [m.home, m.away].includes(team) && [m.home, m.away].includes(us)).sort(byDate) : [];
    const common = isUs ? [] : rows.map((x) => x.team).filter((x) => x !== us && x !== team).map((x) => {
      const res = (t) => L.matches.filter((m) => isPlayed(m) && [m.home, m.away].includes(t) && [m.home, m.away].includes(x)).map((m) => side(m, t));
      return { x, ours: res(us), theirs: res(team) };
    }).filter((c) => c.ours.length && c.theirs.length);
    const perSet = [0, 1, 2, 3, 4].map((i) => {
      const xs = played.filter((s) => s.sets[i]).map((s) => s.sets[i]);
      return { n: i + 1, played: xs.length, won: xs.filter(([a, b]) => a > b).length, diff: xs.reduce((t, [a, b]) => t + a - b, 0) };
    }).filter((x) => x.played);
    const facts = insights(team, games, L);
    const open = (doc) => { if (go) go({ view: "match", matchId: doc.id }); };
    return html`<div class="team-sheet">
      <div class="tm-id">
        <${TeamLogo} name=${team} size=${48} />
        ${info.club ? html`<span>Club : <b>${nice(info.club)}</b></span>` : null}
        ${info.colors ? html`<span>Maillot : <b>${info.colors.toLowerCase()}</b></span>` : null}
        ${info.site ? html`<a href=${info.site} target="_blank" rel="noopener noreferrer">Site du club</a>` : null}
      </div>
      <div class="tm-kpis">
        <div class="tm-kpi"><b>${ordinal(r.rank)}</b><small>sur ${rows.length} · ${plural(r.pts, "point", "points")}</small></div>
        <div class="tm-kpi"><b>${r.v}–${r.d}</b><small>victoires – défaites</small></div>
        <div class="tm-kpi"><b>${r.sw}–${r.sl}</b><small>sets · ratio ${fmtRatio(r.sr)}</small></div>
        <div class="tm-kpi"><b>${r.pw}–${r.pl}</b><small>points · ratio ${fmtRatio(r.pr)}</small></div>
      </div>
      ${vsUs.length ? html`<section class="tm-block vs-us">
        <h3 class="h-sub">Contre ${us}</h3>
        ${vsUs.map((f) => {
          const s = side(f, us), app = appMatchFor(f), gymAddr = f.gym && (L.gyms || {})[f.gym];
          return html`<div class="vs-card" key=${f.code}>
            <div class="vs-head"><b>${when(f, { weekday: "long", day: "numeric", month: "long" })}</b><span class="muted">${s.home ? "à domicile" : "à l’extérieur"} · ${f.code}</span></div>
            ${isPlayed(f) ? html`<p><span class=${cx("res", s.won > s.lost ? "win" : "loss")}>${us} ${s.won}–${s.lost}</span> <span class="tl-sets">${setsText(s.sets)}</span></p>` : null}
            ${!isPlayed(f) && f.gym ? html`<p class="vs-gym"><${Icon} name="pin" size=${16} /><span><b>${nice(f.gym)}</b>${gymAddr ? html`<br />${nice(gymAddr)}` : null}</span>
              <a class="btn ghost sm" href=${mapsUrl(f.gym, gymAddr || "Paris")} target="_blank" rel="noopener noreferrer">Itinéraire</a></p>` : null}
            ${!isPlayed(f) && f.fix ? html`<${FixNote} f=${f} />` : null}
            ${!isPlayed(f) ? html`<${SeDateAsk} f=${f} />` : null}
            ${!isPlayed(f) && (info.colors || ourInfo.colors) ? html`<p class="muted small">Maillots : ${us} ${(ourInfo.colors || "?").toLowerCase()} · ${team} ${(info.colors || "?").toLowerCase()}.</p>` : null}
            ${app ? html`<div><button class="btn ghost sm" onClick=${() => open(app)}>${isPlayed(f) ? "Ouvrir le match dans l’app" : "Voir la préparation du match"}</button></div>`
              : store.readOnly ? null
              : isPlayed(f) || (f.date && f.date <= today) ? html`<div><button class="btn primary sm" onClick=${() => open(createFromFixture(f))}>Créer ce match dans l’app pour la saisie</button></div>`
              : html`<div><button class="btn primary sm" onClick=${() => open(createFromFixture(f))}><${Icon} name="grid" size=${15} />Préparer ce match (compo, consignes)</button></div>`}
            ${!isPlayed(f) && canFix() ? html`<div><button class="btn ghost sm" onClick=${() => openSheet({ type: "fixture-fix", code: f.code })}><${Icon} name="edit" size=${15} />Horaire ou salle changés ? Corriger</button></div>` : null}
          </div>`;
        })}
        ${prevVs.length ? html`<p class="small">Saison ${L.previous.season} : ${prevVs.map((m) => { const s = side(m, us); return `${s.won > s.lost ? "victoire" : "défaite"} ${s.won}–${s.lost} (${s.home ? "dom." : "ext."})`; }).join(" · ")}.</p>` : null}
      </section>` : null}
      ${facts.length ? html`<section class="tm-block"><h3 class="h-sub">À retenir</h3><ul class="tm-facts">${facts.map((f, i) => html`<li key=${i}>${f}</li>`)}</ul></section>` : null}
      ${common.length ? html`<section class="tm-block"><h3 class="h-sub">Adversaires communs</h3>
        <ul class="tm-common">${common.map((c) => html`<li key=${c.x}><b>${c.x}</b>
          <span>${us} : ${c.ours.map((s) => `${s.won}–${s.lost}`).join(", ")}</span>
          <span>${team} : ${c.theirs.map((s) => `${s.won}–${s.lost}`).join(", ")}</span></li>`)}</ul></section>` : null}
      <section class="tm-block"><h3 class="h-sub">Résultats</h3>
        ${played.length ? html`<ul class="tm-lines">${played.slice().reverse().map((s) => html`<${ResultLine} key=${s.m.code} s=${s} onTeam=${onTeam} openSheet=${openSheet} />`)}</ul>` : html`<p class="muted small">Aucun match joué pour l’instant.</p>`}
      </section>
      ${perSet.length ? html`<section class="tm-block"><h3 class="h-sub">Set par set</h3>
        <div class="table-scroll"><table class="standings compact per-set"><thead><tr><th class="st-team" scope="col">Set</th><th scope="col">Gagnés</th><th scope="col">Écart moyen</th></tr></thead>
        <tbody>${perSet.map((x) => html`<tr key=${x.n}><td class="st-team">Set ${x.n}</td><td>${x.won} / ${x.played}</td><td>${(x.diff >= 0 ? "+" : "") + (x.diff / x.played).toFixed(1).replace(".", ",")}</td></tr>`)}</tbody></table></div>
      </section>` : null}
      ${coming.length ? html`<section class="tm-block"><h3 class="h-sub">Prochains matchs</h3>
        <ul class="tm-lines">${coming.slice(0, 4).map((m) => { const s = side(m, team); return html`<li class="tm-line" key=${m.code}>
          <span class="tl-when">${when(m)}<small>${s.home ? "Domicile" : "Extérieur"}</small></span>
          <span class="tl-opp"><${TeamLogo} name=${s.opp} /><button class="linkish" onClick=${() => onTeam(s.opp)}>${s.opp}</button></span>
          <span class="tl-sets">${m.gym ? nice(m.gym) : ""}</span></li>`; })}</ul></section>` : null}
    </div>`;
  }

  /* ---------- Pour le calendrier de l’accueil ---------- */
  /* Matchs de la poule pour notre équipe qui n’ont pas (encore) de match dans l’app. */
  function calendarFixtures() {
    const L = store.league;
    if (!L) return [];
    const ranks = {};
    current().forEach((r) => { ranks[r.team] = r.rank; });
    return ourFixtures().filter((f) => f.date && !appMatchFor(f)).map((f) => {
      const s = side(f, L.team);
      return { f, opp: s.opp, home: s.home, rank: ranks[s.opp], played: isPlayed(f), upcoming: !isPlayed(f) && f.date >= C.todayIso(), days: daysUntil(f.date), gym: f.gym ? nice(f.gym) : "" };
    });
  }

  root.StatorLeague = { table, ourFixtures, calendarFixtures, officialFor, fixtureInfo, fixtureFor, saveFix, canFix, FixtureFix, FixNote, SeDateAsk, sheetCodeFor, SheetPill, MatchSheet, Standings, TeamSheet, ordinal, nice };
})(window);
