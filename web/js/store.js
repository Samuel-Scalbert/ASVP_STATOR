/* ASVP Stator — stockage.
   Mode « api »    : servi par l’app Flask, données dans la base SQL (REST, voir stator/api.py).
   Mode « shared » : publié en artefact Claude, base partagée de l’artefact (capacité db).
   Mode « local »  : ni l’un ni l’autre (fichier ouvert seul) : localStorage. */
(function (root) {
  "use strict";
  const C = root.StatorCore;
  const LS_DATA = "asvp-stator-data-v1";
  const COLS = ["matches", "stats"];

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    mode: "loading",        // loading | api | shared | local
    ready: false,
    readOnly: false,
    sync: "idle",           // idle | saving | saved | error
    notice: null,           // { kind, text }
    config: null, matches: {}, stats: {},
    app: null,              // version du serveur (mode api) : { version, commit, date }
    v: 0, subs: new Set(), db: null,
  };
  function emit() { store.v++; store.subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }

  /* ---------- Écritures (une à la fois par document) ---------- */
  const dirty = new Set(), pending = new Map(), inflight = new Set(), statTimers = new Map();
  let lsTimer = null;

  function persistLocalSoon() {
    clearTimeout(lsTimer);
    lsTimer = setTimeout(() => lsSet(LS_DATA, { config: store.config, matches: store.matches, stats: store.stats }), 200);
  }
  function setSync(s) { if (store.sync !== s) { store.sync = s; emit(); } }
  function updateSync() { setSync(pending.size || inflight.size || statTimers.size ? "saving" : store.sync === "error" ? "error" : "saved"); }

  /* Écriture d’un document selon le mode. Rejette { code, message }. */
  async function backendWrite(path, data) {
    if (store.mode === "shared") {
      const ref = store.db.doc(path);
      return data === null ? ref.delete() : ref.set(data);
    }
    const [col, id] = path.split("/");
    const url = col === "config" ? "api/config" : "api/" + col + "/" + encodeURIComponent(id);
    let res;
    try {
      res = await fetch(url, {
        method: data === null ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: data === null ? undefined : JSON.stringify(data),
      });
    } catch (e) { throw { code: "unavailable", message: "réseau" }; }
    if (res.ok) return;
    let msg = "";
    try { msg = (await res.json()).error || ""; } catch (e) { /* pas de corps JSON */ }
    throw { code: res.status === 403 ? "invalid_argument" : res.status >= 500 ? "unavailable" : "rejected", message: msg };
  }

  function writeDoc(path, data) {
    if (store.mode === "local") { persistLocalSoon(); store.sync = "saved"; return; }
    if ((store.mode !== "shared" && store.mode !== "api") || store.readOnly) return;
    pending.set(path, data);
    dirty.add(path);
    setSync("saving");
    pump(path);
  }
  async function pump(path) {
    if (inflight.has(path)) return;
    inflight.add(path);
    try {
      while (pending.has(path)) {
        const data = pending.get(path);
        pending.delete(path);
        await attempt(path, data, 0);
      }
    } finally {
      inflight.delete(path);
      const sid = path.indexOf("stats/") === 0 ? path.slice(6) : null;
      if (!pending.has(path) && !(sid && statTimers.has(sid))) dirty.delete(path);
      updateSync();
    }
  }
  async function attempt(path, data, tries) {
    try {
      await backendWrite(path, data);
      if (store.sync === "error") store.sync = "saving";
      if (store.notice && store.notice.kind === "net") store.notice = null;
    } catch (e) {
      const code = (e && e.code) || "unavailable";
      if ((code === "unavailable" || code === "resource_exhausted") && tries < 2) {
        await sleep(600 + Math.random() * 1200 * (tries + 1));
        return attempt(path, data, tries + 1);
      }
      store.sync = "error";
      if (code === "invalid_argument") {
        store.readOnly = true;
        store.notice = { kind: "ro", text: "Tu peux consulter les stats, mais pas en saisir : demande au propriétaire de l’app de t’inviter comme éditeur." };
      } else if (code === "rejected") {
        store.notice = { kind: "err", text: "Le serveur a refusé l’enregistrement" + (e.message ? " : " + e.message : ".") };
      } else if (code === "quota_exceeded") {
        store.notice = { kind: "err", text: "La base de l’équipe est pleine. Supprime d’anciens matchs pour libérer de la place." };
      } else if (code === "revoked") {
        store.readOnly = true;
        store.notice = { kind: "ro", text: "L’accès à la base de l’équipe a changé. Recharge la page pour continuer." };
      } else {
        store.notice = { kind: "net", text: "Enregistrement impossible pour l’instant. Vérifie ta connexion : ta saisie reste affichée, refais une modification pour relancer l’envoi." };
      }
      emit();
    }
  }
  function scheduleStats(id, immediate) {
    clearTimeout(statTimers.get(id));
    statTimers.delete(id);
    const go = () => { statTimers.delete(id); const d = store.stats[id]; if (d) writeDoc("stats/" + id, d); else updateSync(); };
    if (store.mode !== "local") dirty.add("stats/" + id);
    if (immediate) go(); else { statTimers.set(id, setTimeout(go, 700)); setSync("saving"); }
  }
  function flush() {
    Array.from(statTimers.keys()).forEach((id) => scheduleStats(id, true));
    if (store.mode === "local") { clearTimeout(lsTimer); lsSet(LS_DATA, { config: store.config, matches: store.matches, stats: store.stats }); }
  }

  /* ---------- Lecture ---------- */
  /* Remplace une collection par ce que dit le serveur, sauf les documents en cours d’enregistrement ici. */
  function applyCollection(col, incoming) {
    const next = {};
    Object.keys(incoming).forEach((id) => { next[id] = C.clone(incoming[id]); next[id].id = id; });
    dirty.forEach((p) => {
      if (p.indexOf(col + "/") !== 0) return;
      const id = p.slice(col.length + 1);
      if (store[col][id] !== undefined) next[id] = store[col][id]; else delete next[id];
    });
    store[col] = next;
  }
  function applyConfig(cfg) { if (!dirty.has("config/team")) store.config = cfg ? C.clone(cfg) : null; }

  function initLocal() {
    const d = lsGet(LS_DATA, null) || {};
    store.mode = "local";
    store.config = d.config || null;
    store.matches = d.matches || {};
    store.stats = d.stats || {};
    store.ready = true;
    emit();
  }

  async function fetchState() {
    const res = await fetch("api/state", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("state " + res.status);
    return res.json();
  }
  async function initApi(first) {
    store.mode = "api";
    store.app = first.app || null;
    applyConfig(first.config);
    COLS.forEach((c) => applyCollection(c, first[c] || {}));
    store.ready = true;
    emit();
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const s = await fetchState();
        store.app = s.app || store.app;
        applyConfig(s.config);
        COLS.forEach((c) => applyCollection(c, s[c] || {}));
        if (store.notice && store.notice.kind === "net") store.notice = null;
        emit();
      } catch (e) { /* le serveur reviendra ; on garde l’affichage */ }
      busy = false;
    };
    setInterval(refresh, 20000);
    root.addEventListener("focus", refresh);
  }

  function onDbError(e) {
    const code = e && e.code;
    if (code === "revoked") { store.readOnly = true; store.notice = { kind: "ro", text: "L’accès à la base de l’équipe a changé. Recharge la page pour continuer." }; }
    else store.notice = { kind: "net", text: "La connexion à la base de l’équipe est interrompue. Recharge la page pour retrouver les dernières saisies." };
    emit();
  }
  async function initShared(db) {
    store.db = db;
    store.mode = "shared";
    const loaded = { config: false, matches: false, stats: false };
    const seen = { config: false, matches: false, stats: false };
    const mark = (k, snap) => {
      seen[k] = true;
      if (!snap.metadata || !snap.metadata.fromCache) loaded[k] = true;
      if (!store.ready && loaded.config && loaded.matches && loaded.stats) store.ready = true;
    };
    setTimeout(() => { if (!store.ready && seen.config && seen.matches && seen.stats) { store.ready = true; emit(); } }, 6000);

    db.doc("config/team").onSnapshot((snap) => {
      applyConfig(snap.exists ? snap.data() : null);
      mark("config", snap); emit();
    }, onDbError);
    COLS.forEach((col) => db.collection(col).onSnapshot((qs) => {
      const incoming = {};
      qs.docs.forEach((d) => { incoming[d.id] = d.data(); });
      applyCollection(col, incoming);
      mark(col, qs); emit();
    }, onDbError));

    try {
      const user = await root.claude.use("user");
      const can = user ? await user.can("data.write") : null;
      if (can === false) {
        store.readOnly = true;
        store.notice = { kind: "ro", text: "Tu consultes les stats en lecture seule. Pour saisir les tiennes, demande au propriétaire de l’app de t’inviter comme éditeur." };
        emit();
      }
    } catch (e) { /* on laisse les écritures refusées trancher */ }
  }
  async function init() {
    if (root.claude && typeof root.claude.use === "function") {
      let db = null;
      try { db = await root.claude.use("db"); } catch (e) { db = null; }
      if (db) return initShared(db);
      return initLocal();
    }
    try {
      const first = await fetchState();
      return initApi(first);
    } catch (e) {
      return initLocal();
    }
  }

  /* ---------- API utilisée par l’interface ---------- */
  const api = {
    saveConfig(cfg) { store.config = cfg; emit(); writeDoc("config/team", cfg); },
    saveMatch(m) {
      store.matches = Object.assign({}, store.matches, { [m.id]: m });
      emit();
      writeDoc("matches/" + m.id, m);
    },
    deleteMatch(id) {
      const ms = Object.assign({}, store.matches); delete ms[id]; store.matches = ms;
      const st = Object.assign({}, store.stats);
      const gone = Object.keys(st).filter((k) => st[k] && st[k].matchId === id);
      gone.forEach((k) => { delete st[k]; clearTimeout(statTimers.get(k)); statTimers.delete(k); });
      store.stats = st;
      emit();
      writeDoc("matches/" + id, null);
      // Le serveur Flask supprime les fiches avec le match ; la base de l’artefact non.
      if (store.mode !== "api") gone.forEach((k) => writeDoc("stats/" + k, null));
    },
    saveStats(doc, immediate) {
      store.stats = Object.assign({}, store.stats, { [doc.id]: doc });
      emit();
      if (store.mode === "local") { persistLocalSoon(); return; }
      scheduleStats(doc.id, immediate);
    },
    flush,
  };

  /* Accès dérivés */
  const q = {
    roster() { return (store.config && Array.isArray(store.config.roster)) ? store.config.roster : []; },
    active() { return q.roster().filter((p) => p.active !== false); },
    name(id) { const p = q.roster().find((x) => x.id === id); return p ? p.name : "Joueur retiré"; },
    posteLabel(id) {
      const p = q.roster().find((x) => x.id === id);
      const r = p && C.ROLES.find((x) => x.k === p.poste);
      return r ? r.label : "";
    },
    matchList() {
      return Object.values(store.matches).filter(Boolean).sort((a, b) => {
        const ka = a.date || (a.createdAt || "").slice(0, 10), kb = b.date || (b.createdAt || "").slice(0, 10);
        return kb.localeCompare(ka) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
    },
    statsOf(matchId) { return Object.values(store.stats).filter((d) => d && d.matchId === matchId); },
    doc(matchId, playerId) { return store.stats[C.statId(matchId, playerId)] || null; },
    /* Joueurs du match : l’effectif actif, plus ceux qui ont saisi puis ont été retirés. */
    playersOf(matchId) {
      const docs = q.statsOf(matchId);
      const list = q.active().map((p) => ({ id: p.id, name: p.name, doc: docs.find((d) => d.playerId === p.id) || null }));
      docs.forEach((d) => { if (!list.some((x) => x.id === d.playerId)) list.push({ id: d.playerId, name: q.name(d.playerId), doc: d }); });
      return list;
    },
  };

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  root.addEventListener("pagehide", flush);

  root.StatorStore = { store, api, q, init, lsGet, lsSet };
})(window);
