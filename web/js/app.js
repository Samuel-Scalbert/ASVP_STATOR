/* ASVP Stator — application : navigation, en-tête, fenêtres, démarrage. */
(function (root) {
  "use strict";
  const { html, render, useState, useEffect, Component } = root.htmPreact;
  const C = root.StatorCore;
  const { store, q, init, lsGet, lsSet } = root.StatorStore;
  const U = root.StatorUI;
  const M = root.StatorMatch;
  const S = root.StatorSeason;
  const { Icon, Sheet, Toasts, cx } = U;

  const NAV = [
    { view: "home", label: "Matchs", icon: "cal", hash: "matchs" },
    { view: "newmatch", label: "Nouveau match", short: "Nouveau", icon: "plus", hash: "nouveau" },
    { view: "season", label: "Saison", icon: "chart", hash: "saison" },
    { view: "tuto", label: "Tuto", icon: "book", hash: "tuto" },
    { view: "team", label: "Équipe", icon: "users", hash: "equipe" },
  ];
  const ROUTE_KEY = "asvp-stator-route";
  function routeFromHash() {
    const raw = (root.location.hash || "").replace("#", "");
    const h = raw === "guide" ? "tuto" : raw; // ancien nom de l’onglet
    const n = NAV.find((x) => x.hash === h);
    return n ? { view: n.view } : null;
  }

  /* Si un écran plante, on affiche une sortie au lieu de figer l’app. */
  class Boundary extends Component {
    constructor(props) { super(props); this.state = { err: null }; }
    componentDidCatch(err) { console.error(err); this.setState({ err }); }
    render() {
      if (!this.state.err) return this.props.children;
      return html`<div class="page"><section class="card empty-state">
        <h2 class="h-sec">Cet écran a rencontré un problème</h2>
        <p class="muted">Les saisies déjà faites sont enregistrées. Reviens aux matchs pour continuer.</p>
        <button class="btn primary" onClick=${() => { this.setState({ err: null }); this.props.onReset(); }}>Revenir aux matchs</button>
      </section></div>`;
    }
  }

  function SyncBadge() {
    if (store.mode === "loading") return html`<span class="sync">Connexion…</span>`;
    if (store.mode === "local") return html`<span class="sync local" title="Les saisies restent sur cet appareil">Hors ligne</span>`;
    if (store.readOnly) return html`<span class="sync ro">Lecture seule</span>`;
    const t = store.sync === "saving" ? "Enregistrement…" : store.sync === "error" ? "Non enregistré"
      : store.mode === "api" ? "Base de l’équipe" : "Équipe en direct";
    return html`<span class=${cx("sync", store.sync === "error" && "err", store.sync === "saving" && "busy")}>${t}</span>`;
  }
  /* Thème : suit l’appareil tant que la personne n’a rien choisi, puis garde son choix. */
  const THEME_KEY = "asvp-stator-theme";
  const applyTheme = (t) => { if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t); };
  applyTheme(lsGet(THEME_KEY, null));
  function ThemeToggle({ compact }) {
    const [, force] = useState(0);
    const attr = document.documentElement.getAttribute("data-theme");
    let dark = attr === "dark";
    if (!attr) { try { dark = root.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { dark = false; } }
    const flip = () => { const t = dark ? "light" : "dark"; applyTheme(t); lsSet(THEME_KEY, t); force((x) => x + 1); };
    return html`<button type="button" class=${cx("theme-toggle", compact && "compact")} role="switch" aria-checked=${dark} aria-label="Mode sombre" onClick=${flip}>
      <${Icon} name=${dark ? "moon" : "sun"} size=${18} />
      ${!compact && html`<span class="theme-t">Mode sombre</span><span class="switch" aria-hidden="true"><span></span></span>`}
    </button>`;
  }
  function Logo({ size }) {
    return html`<img class="logo" src="img/logo-asvp.png" alt="" width=${size} height=${Math.round(size * 1.2)} />`;
  }

  function App({ boot }) {
    const [, force] = useState(0);
    useEffect(() => {
      const f = () => force((x) => x + 1);
      store.subs.add(f);
      f(); // rattrape un chargement terminé avant l’abonnement
      return () => store.subs.delete(f);
    }, []);
    const [route, setRoute] = useState(() => boot.route || routeFromHash() || lsGet(ROUTE_KEY, null) || { view: "home" });
    const [sub, setSub] = useState("synthese");
    const [me, setMeState] = useState(() => lsGet("asvp-stator-me", null));
    const [sheet, setSheet] = useState(null);

    useEffect(() => {
      lsSet(ROUTE_KEY, route);
      try { if (root.claude && root.claude.hot && root.claude.hot.snapshot) root.claude.hot.snapshot(() => ({ route })); } catch (e) { /* pas de rechargement à chaud */ }
    }, [route]);
    useEffect(() => {
      const onHash = () => { const r = routeFromHash(); if (r) setRoute(r); };
      root.addEventListener("hashchange", onHash);
      return () => root.removeEventListener("hashchange", onHash);
    }, []);

    const go = (r) => {
      if (r.view === "entry" && !me) { setSheet({ type: "who", then: r }); return; }
      if (r.view === "match" && (!route.matchId || route.matchId !== r.matchId)) setSub("synthese");
      setRoute(r);
      root.scrollTo(0, 0);
    };
    const setMe = (id) => { setMeState(id); lsSet("asvp-stator-me", id); };
    const openSheet = (s) => {
      if (s.type === "who-picked") { setMe(s.id); return; }
      setSheet(s);
    };
    const close = () => setSheet(null);
    const meValid = me && q.roster().some((p) => p.id === me) ? me : null;

    let view = route.view;
    if ((view === "entry" || view === "match") && store.ready && !store.matches[route.matchId]) view = "home";
    if (view === "entry" && (!meValid || store.readOnly)) view = store.ready ? "match" : view;
    if (view === "entry" && store.ready && store.matches[route.matchId] && store.matches[route.matchId].noData) view = "match"; // pas de fiches pour un match NO VIDEO / NO DATA
    const active = view === "entry" || view === "match" ? "home" : view === "guide" ? "tuto" : view;
    const loading = !store.ready;
    if (loading && view === "entry") view = "loading";

    let body;
    if (loading) {
      body = html`<div class="page"><section class="card empty-state loading-card">
        <${Logo} size=${56} /><h2 class="h-sec">Chargement des stats de l’équipe…</h2>
        <p class="muted">Les matchs, l’effectif et les fiches arrivent dans un instant.</p></section></div>`;
    } else if (view === "entry") {
      const pid = route.playerId && q.roster().some((p) => p.id === route.playerId) ? route.playerId : meValid;
      body = html`<${root.StatorEntry.Entry} key=${route.matchId} matchId=${route.matchId} playerId=${pid} go=${go} onHelp=${(sk) => setSheet({ type: "help", sk })} />`;
    } else if (view === "match") {
      body = html`<${M.MatchView} matchId=${route.matchId} me=${meValid} go=${go} openSheet=${openSheet} sub=${sub} setSub=${setSub} />`;
    } else if (view === "newmatch") body = html`<${M.NewMatch} go=${go} />`;
    else if (view === "season") body = html`<${S.Season} go=${go} />`;
    else if (view === "tuto" || view === "guide") body = html`<${root.StatorTuto.Tuto} anchor=${route.anchor} />`;
    else if (view === "team") body = html`<${S.Team} go=${go} openSheet=${openSheet} me=${meValid} />`;
    else body = html`<${M.Home} me=${meValid} go=${go} openSheet=${openSheet} />`;

    let sheetEl = null;
    if (sheet) {
      if (sheet.type === "help") sheetEl = html`<${Sheet} title=${"Comment compter : " + C.SKILL[sheet.sk].long} onClose=${close}><${M.SkillHelp} sk=${sheet.sk} /><//>`;
      else if (sheet.type === "who") sheetEl = html`<${Sheet} title="Qui es-tu ?" onClose=${close}>
        <p class="muted">Choisis ton nom : il reste mémorisé sur cet appareil. Tu peux aussi remplir la fiche d’un coéquipier.</p>
        <${M.WhoGrid} me=${meValid} onPick=${(id) => { setMe(id); close(); if (sheet.then) { setRoute(sheet.then); root.scrollTo(0, 0); } }} /><//>`;
      else if (sheet.type === "match-form") sheetEl = html`<${Sheet} title=${sheet.m ? "Modifier le match" : "Nouveau match"} onClose=${close}>
        <${M.MatchForm} m=${sheet.m} onDone=${(m, created) => { close(); U.toast(created ? "Match créé." : "Match enregistré."); if (created) go({ view: "match", matchId: m.id }); }} /><//>`;
      else if (sheet.type === "import") sheetEl = html`<${Sheet} title="Importer un Excel de match" onClose=${close}>
        <${S.ImportSheet} onDone=${(m) => { close(); U.toast("Match importé."); go({ view: "match", matchId: m.id }); }} /><//>`;
      else if (sheet.type === "player") sheetEl = html`<${Sheet} title=${sheet.p.name + " · ASVP – " + sheet.m.opponent} onClose=${close} wide><${M.PlayerDetail} p=${sheet.p} m=${sheet.m} /><//>`;
      else if (sheet.type === "delete") sheetEl = html`<${Sheet} title="Supprimer le match" onClose=${close}>
        <${M.DeleteMatch} m=${sheet.m} onCancel=${close} onDone=${() => { close(); U.toast("Match supprimé."); go({ view: "home" }); }} /><//>`;
    }

    const team = (store.config && store.config.team) || "ASVP";
    return html`<div class=${cx("app", view === "entry" && "in-entry")}>
      <aside class="side" aria-label="Navigation">
        <button class="side-brand" onClick=${() => go({ view: "home" })} aria-label="ASVP Stator, accueil">
          <${Logo} size=${112} />
          <span class="side-team">${team === "ASVP" ? html`ASVP <b>Alsa Team</b>` : team}</span>
          <span class="side-app">Stator · stats de match</span>
        </button>
        <nav class="side-nav">
          ${NAV.map((n) => html`<button key=${n.view} class=${cx("side-link", active === n.view && "on")} aria-current=${active === n.view ? "page" : null} onClick=${() => go({ view: n.view })}><${Icon} name=${n.icon} size=${20} /><span>${n.label}</span></button>`)}
        </nav>
        <div class="side-foot">
          <${ThemeToggle} />
          <button class="me-chip" onClick=${() => setSheet({ type: "who" })} aria-label="Changer de joueur">
            <span class="me-k">${meValid ? "Connecté en tant que" : "Pour saisir"}</span><span class="me-v">${meValid ? q.name(meValid) : "Qui es-tu ?"}</span></button>
          <${SyncBadge} />
          ${store.app && store.app.version && html`<span class="app-version" title="Version de l’app sur ce serveur (comparer avec le dernier commit sur GitHub)">
            Version ${store.app.version}${store.app.commit ? " · " + store.app.commit : ""}</span>`}
        </div>
      </aside>
      ${view !== "entry" && html`<header class="topbar">
        <div class="topbar-in">
          <button class="brand" onClick=${() => go({ view: "home" })} aria-label="ASVP Stator, accueil"><${Logo} size=${30} /><span>ASVP <b>Stator</b></span></button>
          <${SyncBadge} />
          <${ThemeToggle} compact />
          <button class="me-chip" onClick=${() => setSheet({ type: "who" })} aria-label="Changer de joueur">${meValid ? q.name(meValid) : "Qui es-tu ?"}</button>
        </div>
      </header>`}
      <main class="main">
        ${store.notice && view !== "entry" && html`<div class="page notice-wrap"><p class=${cx("notice", store.notice.kind)}>${store.notice.text}</p></div>`}
        <${Boundary} key=${view + (route.matchId || "")} onReset=${() => go({ view: "home" })}>${body}<//>
      </main>
      ${view !== "entry" && html`<nav class="tabbar" aria-label="Sections">
        ${NAV.map((n) => html`<button key=${n.view} class=${cx("tab", active === n.view && "on")} aria-current=${active === n.view ? "page" : null} onClick=${() => go({ view: n.view })}><${Icon} name=${n.icon} size=${22} /><span>${n.short || n.label}</span></button>`)}
      </nav>`}
      ${sheetEl}
      <${Toasts} />
    </div>`;
  }

  async function start(data) {
    const mount = document.getElementById("app");
    try {
      const res = await fetch("referentiel.json", { cache: "no-store" });
      if (!res.ok) throw new Error("referentiel " + res.status);
      C.setReferential(await res.json());
    } catch (e) {
      mount.querySelector("p").textContent = "Impossible de charger le référentiel des stats (referentiel.json). Recharge la page ; si le problème continue, vérifie que le serveur tourne.";
      return;
    }
    mount.textContent = "";
    render(html`<${App} boot=${data || {}} />`, mount);
    init();
  }
  const hot = root.claude && root.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})(window);
