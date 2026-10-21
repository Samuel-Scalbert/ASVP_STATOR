/* ASVP Stator — tuto : chaque stat, comment la compter et comment elle est calculée. */
(function (root) {
  "use strict";
  const { html, useState } = root.htmPreact;
  const C = root.StatorCore;
  const { store } = root.StatorStore;
  const U = root.StatorUI;
  const { Icon, Tile, LevelLegend, cx, pct, signed } = U;

  /* Fiche d'exemple suivie tout au long du tuto (chiffres fictifs, par résultat). */
  const EXEMPLE = {
    service: { decisif: 2, incisif: 5, cadeau: 3, erreur: 2 },
    bloc: { decisif: 1, present: 8, absent: 3 },
    reception: { reussie: 9, correcte: 4, erreur: 2 },
    passe: { reussie: 14, moyenne: 5, erreur: 1 },
    attaque: { decisive: 6, incisive: 4, cadeau: 2, erreur: 3 },
  };
  const ex = (sk, o) => (EXEMPLE[sk] && EXEMPLE[sk][o]) || 0;
  const exRate = (s) => {
    const total = Object.keys(s.outcomes).reduce((t, o) => t + ex(s.key, o), 0);
    const ok = s.success.reduce((t, o) => t + ex(s.key, o), 0);
    return { total, ok, rate: total ? ok / total : null };
  };
  /* Les résultats qui comptent un point (+1) ou une faute (−1), d'après le référentiel. */
  const scoring = (sign) => {
    const out = [];
    C.SKILLS.forEach((s) => Object.keys(s.outcomes).forEach((o) => {
      const pt = s.outcomes[o].pt;
      if ((sign > 0 && pt > 0) || (sign < 0 && pt < 0)) out.push({ s, o, label: s.label + " (" + s.outcomes[o].label.toLowerCase() + ")", n: ex(s.key, o) });
    }));
    return out;
  };

  const SECTIONS = [
    ["principe", "Le principe"],
    ["saisie", "Saisir une fiche"],
    ["gestes", "Les gestes et leurs résultats"],
    ["calculs", "Comment les chiffres sont calculés"],
    ["ecrans", "Lire les écrans"],
    ["excel", "Où retrouver l’Excel"],
    ["faq", "Questions fréquentes"],
  ];
  const goTo = (id) => {
    const el = document.getElementById("tuto-" + id);
    if (el) el.scrollIntoView({ behavior: root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  function Formula({ label, expr, example }) {
    return html`<div class="formula">
      <div class="f-label">${label}</div>
      <div class="f-expr">${expr}</div>
      ${example && html`<div class="f-ex"><span class="f-ex-k">Exemple</span><span>${example}</span></div>`}
    </div>`;
  }

  /* Zone d'essai : les cases du service, sans rien enregistrer. */
  function TryPad() {
    const s = C.SKILL.service;
    const [counts, setCounts] = useState({});
    if (!s) return null;
    const set = { service: counts };
    const r = C.sumSkill([set], "service");
    const sl = C.scoreLine([set]);
    const bump = (k, d) => setCounts((c) => {
      const v = Math.max(0, (c[k] || 0) + d);
      const next = Object.assign({}, c);
      if (v) next[k] = v; else delete next[k];
      return next;
    });
    const succ = s.success.map((o) => s.outcomes[o].label.toLowerCase()).join(" + ");
    return html`<div class="try">
      <div class="try-head"><b>Essaie ici</b><span class="muted small">Ces cases ne comptent pour personne.</span>
        <button class="btn ghost sm" onClick=${() => setCounts({})} disabled=${!r.total}>Remettre à zéro</button></div>
      <div class=${"pad c" + s.fields.length}>
        ${s.fields.map((f) => html`<${Tile} key=${f.k} f=${f} n=${C.setVal(set, "service", f.k)} onTap=${() => bump(f.k, 1)} onMinus=${() => bump(f.k, -1)} aria=${"Essai service " + f.label.toLowerCase()} />`)}
      </div>
      <div class="try-calc" aria-live="polite">
        ${r.total
          ? html`<span>Taux de transformation = ${succ} ÷ total = <b>${r.ok} ÷ ${r.total} = ${pct(r.rate)}</b></span>
              <span>Points marqués : <b>${sl.P}</b> · Fautes : <b>${sl.F}</b> · Différence : <b>${signed(sl.diff)}</b></span>`
          : html`<span class="muted">Touche une case : le calcul s’affiche ici.</span>`}
      </div>
    </div>`;
  }

  function Tuto() {
    const plus = scoring(1), minus = scoring(-1);
    const P = plus.reduce((t, x) => t + x.n, 0), F = minus.reduce((t, x) => t + x.n, 0);
    const srv = { rel: ex("service", "incisif"), att: ex("service", "cadeau") };
    const atk = { rel: ex("attaque", "incisive"), att: ex("attaque", "cadeau") };
    return html`<div class="page wide tuto">
      <div class="tuto-head">
        <span class="eyebrow">Tuto</span>
        <h1 class="h-page">Comprendre les stats</h1>
        <p class="lead">Ce qu’on compte pendant un match, comment le saisir, et comment chaque chiffre de l’app est calculé. Les exemples suivent la même fiche fictive d’un joueur, du début à la fin.</p>
      </div>
      <div class="tuto-layout">
        <nav class="toc" aria-label="Sommaire du tuto">
          <span class="toc-t">Sommaire</span>
          ${SECTIONS.map(([id, t], i) => html`<button key=${id} class="toc-link" onClick=${() => goTo(id)}><span class="toc-n">${i + 1}</span>${t}</button>`)}
        </nav>
        <div class="tuto-body">

          <section class="card" id="tuto-principe">
            <h2 class="h-sec"><span class="sec-n">1</span>Le principe</h2>
            <p>Après chaque match, on remplit une <b>fiche par joueur</b> : ce qu’il a fait à chaque geste (service, bloc, réception, passe, attaque), <b>set par set</b>, puis un court bilan. L’app additionne et calcule tout le reste : points marqués, fautes, taux de transformation, tableaux de l’équipe et de la saison.</p>
            <ol class="howto">
              <li><b>Ouvre le match</b> (onglet Matchs), puis « Saisir les stats ».</li>
              <li><b>Compte les actions</b> de chaque joueur, set par set : une touche = une action.</li>
              <li><b>Écris le bilan</b> : les + et les − pour soi, puis pour l’équipe.</li>
            </ol>
          </section>

          <section class="card" id="tuto-saisie">
            <h2 class="h-sec"><span class="sec-n">2</span>Saisir une fiche</h2>
            <ul class="bullets">
              <li><b>Le joueur</b> se choisit en haut de l’écran. « Joueur suivant », à la fin du bilan, enchaîne les fiches : une seule personne peut saisir toute l’équipe.</li>
              <li><b>Les sets</b> sont des onglets. Un set sans aucune stat apparaît <span class="pill-demo">grisé</span> : le joueur n’était pas sur le terrain. Il reste cliquable en cas d’oubli.</li>
              <li><b>Toucher une case</b> ajoute 1. Le <b>−</b> dans son coin retire 1. « Annuler », en bas, efface la dernière touche.</li>
              <li><b>La vidéo YouTube</b> du match, si son lien est renseigné, s’affiche à côté des cases sur PC et reste en place quand on change de set ou de joueur.</li>
              <li><b>Tout s’enregistre seul</b>, à chaque touche. Il n’y a rien à envoyer.</li>
            </ul>
            <${TryPad} />
          </section>

          <section class="card" id="tuto-gestes">
            <h2 class="h-sec"><span class="sec-n">3</span>Les gestes et leurs résultats</h2>
            <p>Chaque geste a 3 ou 4 résultats, classés du meilleur au pire. La couleur d’un résultat est la même partout dans l’app :</p>
            <${LevelLegend} />
            <p class="muted small">Le badge <span class="tile-pt inline plus">+1 pt</span> signale un résultat qui compte comme point marqué, le badge <span class="tile-pt inline minus">−1 pt</span> un résultat qui compte comme faute.</p>
            <div class="guide-skills">
              ${C.SKILLS.map((s) => html`<div class="guide-skill" key=${s.key}>
                <h3>${s.long}</h3>
                <p class="muted"><b>On compte :</b> ${s.scope}</p>
                <ul class="defs">${Object.keys(s.outcomes).map((o) => { const oc = s.outcomes[o]; return html`<li key=${o} class=${"def l" + oc.lvl}>
                  <div class="def-h"><b>${oc.label}</b>${oc.pt ? html`<span class=${cx("tile-pt inline", oc.pt > 0 ? "plus" : "minus")}>${oc.pt > 0 ? "+1 pt" : "−1 pt"}</span>` : null}</div><p>${oc.def}</p></li>`; })}</ul>
              </div>`)}
            </div>
            <div class="help-court"><p><b>Passes et attaques par poste.</b> Pour ces deux gestes, on note aussi le poste : celui que sert la passe, ou celui d’où part l’attaque. Vu de l’arrière du terrain, le poste 4 est à gauche au filet, le 3 au centre, le 2 à droite.</p><${U.Court} /></div>
          </section>

          <section class="card" id="tuto-calculs">
            <h2 class="h-sec"><span class="sec-n">4</span>Comment les chiffres sont calculés</h2>
            <div class="example-sheet">
              <span class="f-ex-k">Fiche d’exemple (un joueur, un match)</span>
              <ul>${C.SKILLS.map((s) => html`<li key=${s.key}><b>${s.label}</b> : ${Object.keys(s.outcomes).map((o) => s.outcomes[o].label.toLowerCase() + " " + ex(s.key, o)).join(" · ")}</li>`)}</ul>
            </div>

            <h3 class="h-calc">Points marqués, fautes, différence</h3>
            <${Formula} label="Points marqués" expr=${plus.map((x) => x.label).join(" + ")}
              example=${plus.map((x) => x.label + " : " + x.n).join(" · ") + " → " + P + " points marqués"} />
            <${Formula} label="Fautes (points perdus)" expr=${minus.map((x) => x.label).join(" + ")}
              example=${minus.map((x) => x.label + " : " + x.n).join(" · ") + " → " + F + " fautes"} />
            <${Formula} label="Différence" expr="Points marqués − fautes"
              example=${P + " − " + F + " = " + signed(P - F) + " : positive, le joueur rapporte plus de points qu’il n’en donne."} />

            <h3 class="h-calc">Taux de transformation</h3>
            <p>Pour chaque geste : la part des gestes réussis sur tous les gestes tentés.</p>
            <div class="tbl-wrap"><table class="tbl map">
              <thead><tr><th scope="col" class="left">Geste</th><th scope="col" class="left">Calcul</th><th scope="col" class="left">Exemple</th></tr></thead>
              <tbody>${C.SKILLS.map((s) => { const r = exRate(s); return html`<tr key=${s.key}>
                <th scope="row" class="left">${s.label}</th><td class="left">${s.rateText}</td>
                <td class="left">${r.total ? r.ok + " " + U.agree(s.rateName, r.ok) + " ÷ " + r.total + " = " + pct(r.rate) : "—"}</td></tr>`; })}</tbody>
            </table></div>
            <${Formula} label="Sur un match ou une saison" expr="Total des gestes réussis ÷ total des gestes, tous sets confondus"
              example="Réception : set 1 → 1 réussie sur 1 (100 %), set 2 → 6 sur 12 (50 %). Sur le match : 7 ÷ 13 = 54 %. La moyenne des deux sets donnerait 75 %, comme si une seule réception pesait autant que douze." />
            <p class="muted small">Pour les passes et les attaques, les postes 2, 3 et 4 sont comptés séparément mais additionnés dans le taux.</p>

            <h3 class="h-calc">Score et stats</h3>
            <${Formula} label="Points venus des fautes adverses (ou non saisis)" expr="Score de l’ASVP dans le set − points marqués saisis"
              example="Set gagné 25–20, l’équipe a saisi 15 points marqués : 25 − 15 = 10 points venus des fautes de l’adversaire, ou d’actions oubliées." />
            <${Formula} label="Points gagnés par l’adversaire sur ses actions (ou non saisis)" expr="Score de l’adversaire dans le set − fautes saisies"
              example="20 points adverses, l’équipe a saisi 6 fautes : 20 − 6 = 14 points marqués par l’adversaire lui-même (attaques, aces, contres) ou non saisis." />

            <h3 class="h-calc">Ce qu’on laisse à l’adversaire</h3>
            <p>Quand notre service ou notre attaque passe sans marquer, l’adversaire est soit réduit à une simple relance (résultat « incisif »), soit capable d’attaquer (résultat « cadeau »).</p>
            <${Formula} label="Part qui lui laisse une attaque" expr="Cadeaux ÷ (incisifs + cadeaux)"
              example=${"Après nos services : " + srv.att + " ÷ (" + srv.rel + " + " + srv.att + ") = " + pct(srv.att / (srv.rel + srv.att)) + ". Après nos attaques : " + atk.att + " ÷ (" + atk.rel + " + " + atk.att + ") = " + pct(atk.att / (atk.rel + atk.att)) + "."} />

            <h3 class="h-calc">Équipe et saison</h3>
            <ul class="bullets">
              <li><b>Totaux d’équipe</b> : la somme des fiches de tous les joueurs, set par set et sur le match.</li>
              <li><b>Saisies</b> : « 5 sur 14 » = joueurs ayant au moins une action ou un bilan, sur l’effectif.</li>
              <li><b>Saison</b> : les totaux additionnent tous les matchs saisis ; les taux sont recalculés sur l’ensemble des gestes de la saison, de la même façon que sur un match.</li>
            </ul>
          </section>

          <section class="card" id="tuto-ecrans">
            <h2 class="h-sec"><span class="sec-n">5</span>Lire les écrans</h2>
            <dl class="calc">
              <dt>Matchs</dt><dd>Le dernier match en grand, avec le nombre de fiches remplies, puis la liste de tous les matchs.</dd>
              <dt>Match › Synthèse</dt><dd>Qui a rempli sa fiche, les points et fautes de l’équipe, les taux par geste, d’où viennent les points de chaque set, et ce qu’on laisse à l’adversaire.</dd>
              <dt>Match › Joueurs</dt><dd>Le classement des joueurs (points, fautes, différence) et leurs taux, pour le match entier ou un set. Plus bas, « Détail set par set » montre un tableau joueurs × sets, comme les feuilles STATS de l’Excel.</dd>
              <dt>Match › Bilans</dt><dd>Tous les bilans collectifs (les + et les −) regroupés, puis les bilans perso de chaque joueur.</dd>
              <dt>Saison</dt><dd>Victoires, sets, courbe des taux match par match (pour l’équipe ou un joueur) et totaux de chaque joueur.</dd>
              <dt>Bouton « Excel »</dt><dd>Sur un match : le fichier au format habituel (BILAN, STATS Points, STATS Taux de transformation, une feuille par joueur). Sur la saison : un récapitulatif de tous les matchs.</dd>
            </dl>
          </section>

          <section class="card" id="tuto-excel">
            <h2 class="h-sec"><span class="sec-n">6</span>Où retrouver l’Excel</h2>
            <p class="muted small">Tout ce que l’ancien fichier demandait ou calculait est repris.</p>
            <div class="tbl-wrap"><table class="tbl map">
              <thead><tr><th scope="col" class="left">Dans l’Excel</th><th scope="col" class="left">Dans l’app</th></tr></thead>
              <tbody>
                <tr><th scope="row" class="left">Feuille de chaque joueur (cases à remplir)</th><td class="left">Saisir les stats : une case par ligne de l’Excel, set par set</td></tr>
                <tr><th scope="row" class="left">Taux de transformation, points marqués, erreurs</th><td class="left">Calculés seuls : en haut de chaque geste et dans le bilan de la fiche</td></tr>
                <tr><th scope="row" class="left">Bilan perso et collectif (+ / −)</th><td class="left">Onglet Bilan de la fiche ; tous les bilans dans Match › Bilans</td></tr>
                <tr><th scope="row" class="left">Feuille BILAN</th><td class="left">Match › Bilans</td></tr>
                <tr><th scope="row" class="left">STATS Points (par joueur et par set, différence)</th><td class="left">Match › Joueurs › Détail set par set</td></tr>
                <tr><th scope="row" class="left">STATS Taux de transformation</th><td class="left">Match › Joueurs › Détail set par set (choisir « Taux … »)</td></tr>
                <tr><th scope="row" class="left">Vérification avec score final</th><td class="left">Match › Synthèse › D’où viennent les points</td></tr>
                <tr><th scope="row" class="left">Statistique équipe adverse</th><td class="left">Match › Synthèse › Ce qu’on laisse à l’adversaire</td></tr>
                <tr><th scope="row" class="left">Légende</th><td class="left">« Comment compter » sur chaque geste, et ce tuto</td></tr>
              </tbody>
            </table></div>
            <p class="muted small">Deux calculs diffèrent volontairement de l’ancien fichier : les totaux d’équipe comptent tous les joueurs (l’Excel en oubliait certains), et le taux d’un match est calculé sur tous les gestes plutôt qu’en moyenne des sets.</p>
          </section>

          <section class="card" id="tuto-faq">
            <h2 class="h-sec"><span class="sec-n">7</span>Questions fréquentes</h2>
            <dl class="faq">
              <dt>Un joueur n’a pas joué un set.</dt><dd>On laisse le set vide : il apparaît grisé, et seuls les gestes saisis comptent.</dd>
              <dt>J’ai touché la mauvaise case.</dt><dd>Le − dans le coin de la case retire 1 ; « Annuler » en bas efface la dernière touche.</dd>
              <dt>Comment aller plus vite ?</dt><dd>Renseigne le lien YouTube du match (bouton « Modifier » du match) : sur PC, la vidéo s’affiche à côté des cases. Avec « Joueur suivant », une seule personne saisit toute l’équipe en revoyant le match.</dd>
              <dt>Un joueur ne sait pas s’il doit compter une action.</dt><dd>« Comment compter », à côté de chaque geste, donne la définition de chaque résultat.</dd>
              <dt>Où vont les données ?</dt><dd>${store.mode === "local" ? "Sur cet appareil uniquement (mode hors ligne). Exporte l’Excel pour les transmettre." : "Dans la base de l’équipe : tout le monde voit la même chose, sans fichier à s’échanger."}</dd>
              <dt>Le coach veut toujours son fichier Excel.</dt><dd>Bouton « Excel » sur la page du match : il produit le fichier au format habituel.</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>`;
  }

  root.StatorTuto = { Tuto };
})(window);
