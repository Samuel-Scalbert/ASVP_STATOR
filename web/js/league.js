/* ASVP Stator — championnat FFVolley : classement, journées et fiche de chaque équipe.
   Les données viennent du site de la fédération (stator/ffvb.py). Seuls les matchs de la poule et leurs
   scores sont stockés : le classement, les statistiques et les points à retenir sur chaque adversaire sont
   recalculés ici à chaque affichage. */
(function (root) {
  "use strict";
  const { html, useState } = root.htmPreact;
  const C = root.StatorCore;
  const { store, api, q } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, cx, plural, fmtDate, fmtTime } = U;

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
    + encodeURIComponent([/gymnase/i.test(gym) ? nice(gym) : "Gymnase " + nice(gym), nice(address)].filter(Boolean).join(", "));
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
  function ResultLine({ s, onTeam }) {
    const w = s.won > s.lost;
    return html`<li class="tm-line">
      <span class="tl-when">${when(s.m)}<small>${s.home ? "Domicile" : "Extérieur"}</small></span>
      <span class="tl-opp">${onTeam ? html`<button class="linkish" onClick=${() => onTeam(s.opp)}>${s.opp}</button>` : s.opp}</span>
      <span class=${cx("res", w ? "win" : "loss")}>${w ? "V" : "D"} ${s.won}–${s.lost}</span>
      <span class="tl-sets">${setsText(s.sets)}</span>
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
        <td class="st-team">${onTeam ? html`<button class="linkish" onClick=${(e) => { e.stopPropagation(); onTeam(r.team); }}>${r.team}</button>` : r.team}${r.pen ? html`<small class="st-pen" title="Écart avec le barème : forfait ou pénalité">${r.pen > 0 ? "+" : ""}${r.pen} pt</small>` : null}</td>
        <td class="st-pts">${r.pts}</td><td>${r.j}</td><td>${r.v}</td><td>${r.d}</td><td>${r.sw}–${r.sl}</td>
        ${compact ? null : html`<td class="opt">${fmtRatio(r.sr)}</td><td class="opt">${r.pw}–${r.pl}</td><td class="opt">${fmtRatio(r.pr)}</td>
        <td><${Form} list=${r.form} /></td>`}
      </tr>`)}</tbody>
    </table></div>`;
  }
  function Rounds({ L, onTeam }) {
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
          <span class="rl-teams"><button class="linkish" onClick=${() => onTeam(m.home)}>${m.home}</button><i>–</i><button class="linkish" onClick=${() => onTeam(m.away)}>${m.away}</button></span>
          <span class="rl-score">${isPlayed(m) ? html`<b>${h}–${a}</b><small>${setsText(m.sets)}</small>` : html`<small>${m.gym ? nice(m.gym) : ""}</small>`}</span>
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
        <div class="nb-main"><b>${next.home} – ${next.away}</b>${oppRow ? html`<span class="rank-chip">${opp} : ${ordinal(oppRow.rank)} au classement</span>` : null}</div>
        <button class="btn primary sm" onClick=${() => onTeam(opp)}>Fiche de l’adversaire</button>
      </section>`}
      <section class="card table-card">
        <${StandingsTable} rows=${rows} us=${L.team} onTeam=${onTeam} />
        <p class="muted small table-foot">Mis à jour ${updatedText(L.updatedAt)} depuis le site de la FFVolley. Clique sur une équipe pour voir sa fiche.</p>
      </section>
      <${Rounds} L=${L} onTeam=${onTeam} />
      ${prev && html`<details class="card prev-season"><summary><b>Saison ${L.previous.season}</b> : classement final</summary>
        <${StandingsTable} rows=${prev} us=${L.team} compact /></details>`}
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
            ${!isPlayed(f) && (info.colors || ourInfo.colors) ? html`<p class="muted small">Maillots : ${us} ${(ourInfo.colors || "?").toLowerCase()} · ${team} ${(info.colors || "?").toLowerCase()}.</p>` : null}
            ${app ? html`<div><button class="btn ghost sm" onClick=${() => open(app)}>Ouvrir le match dans l’app</button></div>`
              : !store.readOnly && (isPlayed(f) || (f.date && f.date <= today)) ? html`<div><button class="btn primary sm" onClick=${() => open(createFromFixture(f))}>Créer ce match dans l’app pour la saisie</button></div>` : null}
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
        ${played.length ? html`<ul class="tm-lines">${played.slice().reverse().map((s) => html`<${ResultLine} key=${s.m.code} s=${s} onTeam=${onTeam} />`)}</ul>` : html`<p class="muted small">Aucun match joué pour l’instant.</p>`}
      </section>
      ${perSet.length ? html`<section class="tm-block"><h3 class="h-sub">Set par set</h3>
        <div class="table-scroll"><table class="standings compact per-set"><thead><tr><th class="st-team" scope="col">Set</th><th scope="col">Gagnés</th><th scope="col">Écart moyen</th></tr></thead>
        <tbody>${perSet.map((x) => html`<tr key=${x.n}><td class="st-team">Set ${x.n}</td><td>${x.won} / ${x.played}</td><td>${(x.diff >= 0 ? "+" : "") + (x.diff / x.played).toFixed(1).replace(".", ",")}</td></tr>`)}</tbody></table></div>
      </section>` : null}
      ${coming.length ? html`<section class="tm-block"><h3 class="h-sub">Prochains matchs</h3>
        <ul class="tm-lines">${coming.slice(0, 4).map((m) => { const s = side(m, team); return html`<li class="tm-line" key=${m.code}>
          <span class="tl-when">${when(m)}<small>${s.home ? "Domicile" : "Extérieur"}</small></span>
          <span class="tl-opp"><button class="linkish" onClick=${() => onTeam(s.opp)}>${s.opp}</button></span>
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

  root.StatorLeague = { table, ourFixtures, calendarFixtures, officialFor, Standings, TeamSheet, ordinal, nice };
})(window);
