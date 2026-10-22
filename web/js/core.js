/* ASVP Stator — cœur métier : référentiel des gestes, calculs, import/export Excel.
   Aucune dépendance au DOM : ce fichier est aussi chargé par les tests Node. */
(function (root) {
  "use strict";

  const MAX_SETS = 5;
  const SET_COLS = ["E", "F", "G", "H", "I"];
  /* Référentiel (gestes, résultats, postes) : chargé depuis referentiel.json par setReferential(). */
  let POSTES = [], LEVELS = {}, ROLES = [], SKILLS = [], SKILL = {};
  function setReferential(ref) {
    LEVELS = Object.assign({}, ref.levels);
    ROLES = (ref.roles || []).map((r) => ({ k: r.key, label: r.label }));
    POSTES = (ref.court_positions || []).map((p) => ({ n: p.n, label: p.label, sub: p.sub }));
    SKILLS = ref.skills.map((s) => {
      const outcomes = {};
      Object.keys(s.outcomes).forEach((k) => {
        const o = s.outcomes[k];
        outcomes[k] = { label: o.label, hint: o.hint, lvl: o.level, pt: o.points || 0, def: o.definition };
      });
      const sk = { key: s.key, label: s.label, long: s.long || s.label, scope: s.scope, rateText: s.rate_text, rateName: s.rate_name,
        success: s.success, rateRow: s.excel_rate_row || null, outcomes };
      sk.fields = s.fields.map((f) => Object.assign({}, outcomes[f.outcome], { k: f.key, o: f.outcome, p: f.court_position || 0, row: f.excel_row || null, skill: s.key }));
      sk.hasPostes = sk.fields.some((f) => f.p);
      return sk;
    });
    SKILL = {};
    SKILLS.forEach((s) => { SKILL[s.key] = s; });
  }

  /* ---------- Petits utilitaires ---------- */
  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function slug(s) {
    return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "joueur";
  }
  function uid(prefix) {
    return (prefix || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function statId(matchId, playerId) { return matchId + "__" + playerId; }

  /* ---------- Calculs ---------- */
  function setVal(set, sk, k) {
    const v = set && set[sk] && set[sk][k];
    return typeof v === "number" && v > 0 ? v : 0;
  }
  function setsArray(doc) {
    const out = [];
    for (let i = 1; i <= MAX_SETS; i++) out.push((doc && doc.sets && doc.sets[i]) || null);
    return out;
  }
  function sumSkill(sets, sk) {
    const s = SKILL[sk];
    const by = {}, byO = {};
    s.fields.forEach((f) => { by[f.k] = 0; });
    Object.keys(s.outcomes).forEach((o) => { byO[o] = 0; });
    let total = 0, ok = 0;
    sets.forEach((set) => {
      if (!set) return;
      s.fields.forEach((f) => {
        const v = setVal(set, sk, f.k);
        if (!v) return;
        by[f.k] += v; byO[f.o] += v; total += v;
        if (s.success.indexOf(f.o) >= 0) ok += v;
      });
    });
    return { by, byO, total, ok, rate: total ? ok / total : null };
  }
  function scoreLine(sets) {
    const pts = { attaque: 0, service: 0, bloc: 0 };
    const flt = { attaque: 0, service: 0, reception: 0, passe: 0 };
    let actions = 0;
    sets.forEach((set) => {
      if (!set) return;
      SKILLS.forEach((s) => s.fields.forEach((f) => {
        const v = setVal(set, s.key, f.k);
        if (!v) return;
        actions += v;
        if (f.pt > 0) pts[s.key] += v;
        else if (f.pt < 0) flt[s.key] += v;
      }));
    });
    const P = pts.attaque + pts.service + pts.bloc;
    const F = flt.attaque + flt.service + flt.reception + flt.passe;
    return { pts, flt, P, F, diff: P - F, actions };
  }
  function countActions(set) { return scoreLine([set]).actions; }
  function hasBilan(doc) {
    const b = (doc && doc.bilan) || {};
    return ["pp", "pm", "cp", "cm"].some((k) => b[k] && String(b[k]).trim());
  }
  function isFilled(doc) { return !!doc && (scoreLine(setsArray(doc)).actions > 0 || hasBilan(doc)); }
  /* Ce que l’adversaire peut faire après nos services et nos attaques (bloc « STATISTIQUE EQUIPE ADVERSE »). */
  function opponentLine(setsList) {
    const r = { srvRel: 0, srvAtt: 0, attRel: 0, attAtt: 0 };
    setsList.forEach((sets) => sets.forEach((set) => {
      r.srvRel += setVal(set, "service", "incisif");
      r.srvAtt += setVal(set, "service", "cadeau");
      r.attRel += setVal(set, "attaque", "incisive");
      r.attAtt += setVal(set, "attaque", "cadeau");
    }));
    return r;
  }

  /* ---------- Matchs ---------- */
  function matchSets(m) {
    return ((m && m.sets) || []).filter((s) => s && Number.isFinite(s.a) && Number.isFinite(s.o));
  }
  function matchResult(m) {
    const ss = matchSets(m);
    if (ss.length) {
      let a = 0, o = 0;
      ss.forEach((s) => { if (s.a > s.o) a++; else if (s.o > s.a) o++; });
      return { a, o, fromSets: true };
    }
    if (m && m.result && Number.isFinite(m.result.a) && Number.isFinite(m.result.o)) return { a: m.result.a, o: m.result.o };
    return null;
  }
  function matchSetCount(m) {
    const ss = matchSets(m);
    if (ss.length) return ss.length;
    const r = matchResult(m);
    return r ? r.a + r.o : 0;
  }
  function seasonOf(dateStr) {
    if (!dateStr) return null;
    const [y, mo] = dateStr.split("-").map(Number);
    if (!y || !mo) return null;
    const start = mo >= 8 ? y : y - 1;
    return start + "-" + (start + 1);
  }

  /* ---------- Import d’un Excel au format ASVP ----------
     cell(sheetName, ref) renvoie la valeur mise en cache de la cellule (texte, nombre ou undefined). */
  function parseWorkbookData(sheetNames, cell, fileName) {
    const txt = (sn, ref) => {
      const v = cell(sn, ref);
      if (v == null || typeof v === "boolean") return "";
      const s = String(v).trim();
      return s === "0" ? "" : s;
    };
    const num = (sn, ref) => {
      const v = cell(sn, ref);
      const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", "."));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    const players = [];
    sheetNames.forEach((sn) => {
      if (norm(txt(sn, "B3")) !== "services" || norm(txt(sn, "B24")) !== "attaques") return;
      const sets = {};
      SET_COLS.forEach((col, i) => {
        const so = {};
        let any = false;
        SKILLS.forEach((s) => s.fields.forEach((f) => {
          const n = f.row ? num(sn, col + f.row) : 0;
          if (!n) return;
          (so[s.key] = so[s.key] || {})[f.k] = n;
          any = true;
        }));
        if (any) sets[i + 1] = so;
      });
      players.push({
        sheet: sn, name: txt(sn, "B2") || sn, sets,
        bilan: { pp: txt(sn, "M32"), pm: txt(sn, "M35"), cp: txt(sn, "M37"), cm: txt(sn, "M40") },
      });
    });
    // Feuille BILAN : certains joueurs écrivent directement dedans au lieu de leur propre feuille.
    const bilanSheet = sheetNames.find((n) => norm(n) === "bilan");
    if (bilanSheet) {
      let block = null;
      for (let r = 1; r <= 120; r++) {
        const c = norm(txt(bilanSheet, "C" + r));
        if (c.indexOf("bilan personnel") === 0) { block = "perso"; continue; }
        if (c.indexOf("bilan collectif") === 0) { block = "co"; continue; }
        if (!block) continue;
        const who = norm(txt(bilanSheet, "B" + r));
        if (!who) continue;
        const p = players.find((x) => norm(x.name) === who || norm(x.sheet) === who);
        if (!p) continue;
        const plus = txt(bilanSheet, "C" + r), minus = txt(bilanSheet, "D" + r);
        if (block === "perso") { if (!p.bilan.pp) p.bilan.pp = plus; if (!p.bilan.pm) p.bilan.pm = minus; }
        else { if (!p.bilan.cp) p.bilan.cp = plus; if (!p.bilan.cm) p.bilan.cm = minus; }
      }
    }
    players.forEach((p) => {
      p.actions = scoreLine(setsArray(p)).actions;
      p.filled = p.actions > 0 || hasBilan(p);
    });
    const base = String(fileName || "").replace(/\.[a-z0-9]+$/i, "").trim();
    const parts = base.split(/\s+[-–—]\s+|\s+vs?\.?\s+/i).map((x) => x.trim()).filter(Boolean);
    const opponent = parts.find((x) => norm(x) !== "asvp") || "";
    return { opponent, players };
  }

  /* ---------- Export Excel au format habituel (valeurs, sans formules) ---------- */
  const XL_LABELS = {
    K2: "LÉGENDE",
    B3: "Services", C3: "Décisifs", C4: "Incisifs", C5: "Cadeaux", C6: "Erreurs", B7: "Taux de transformation service",
    B8: "Blocs / défense au filet", C8: "Décisifs - marquant point", C9: "Présence au bloc ou décollé du bloc en défense", C10: "Absence de bloc",
    B11: "Taux de transformation bloc",
    B12: "Réceptions en première touche", C12: "Réussies", C13: "Correctes", C14: "Erreurs", B15: "Taux de transformation réception",
    B16: "Passes", C16: "Réussies pour la", D16: 2, D17: 3, D18: 4, C19: "Moyennes pour la", D19: 2, D20: 3, D21: 4, C22: "Erreurs",
    B23: "Taux de transformation passe",
    B24: "Attaques", C24: "Décisives depuis poste", D24: 2, D25: 3, D26: 4, C27: "Incisives", C28: "Cadeaux", C29: "Erreurs",
    B30: "Taux de transformation de l’attaque",
    B33: "Pts marqués", C33: "Attaques", C34: "Services", C35: "Blocs", C36: "TOTAL",
    B37: "Erreurs", C37: "Attaques", C38: "Services", C39: "Réception", C40: "Passes", C41: "TOTAL",
    K32: "BILAN PERSO", L32: "Les +", L35: "Les -", K37: "BILAN COLLECTIF", L37: "Les +", L40: "Les -",
    K3: "Tous services",
    M3: "Service marquant le point directement ou qui empêche l’équipe adverse de renvoyer le ballon",
    M4: "Service réussi passant de l’autre côté du filet et provoquant une relance de la part de l’équipe adverse",
    M5: "Service réussi passant de l’autre côté du filet et provoquant une attaque de l’équipe adverse",
    M6: "Service raté",
    K7: "Nombre de services décisifs par rapport au nombre total de services effectués",
    K8: "Tous blocs de l’attaque adverse",
    M8: "Tout bloc réussi - bloquant la balle et marquant le point",
    M9: "Tout bloc permettant de bloquer une direction d’attaque et forçant l’attaque vers l’autre direction, ou bloc qui ralentit l’attaque",
    M10: "Bloc non réalisé alors qu’il aurait dû être fait pour au moins gêner l’adversaire",
    K11: "Nombre de blocs décisifs par rapport au nombre total de blocs effectués",
    K12: "Toute réception du service adverse ou réception de l’attaque adverse",
    M12: "Réception réussie et remise correctement au centre du terrain permettant une passe sereine",
    M13: "Réception rattrapée mais qui ne permet pas de faire une passe sereine derrière",
    M14: "Réception ratée : pas de réception ou touchée qui sort du terrain ou touchée ne permettant pas un renvoi de l’autre côté du terrain au bout de 3 touches",
    K15: "Nombre de réceptions réussies par rapport au nombre total de réceptions effectuées",
    K16: "Toute passe sur le terrain",
    M16: "Passes bien placées - Passes correctes après réceptions correctes",
    M19: "Passes moyennes provoquant une relance car manque de précision/hauteur pour l’attaque",
    M22: "Passes ratées ne permettant pas l’attaque - erreur directe où on perd le point",
    K23: "Nombre de passes réussies par rapport au nombre total de passes effectuées",
    K24: "Toute attaque (frappée ou poussée dix doigts ou petite bidouille) - en deuxième ou troisième voire première main sur relance de l’équipe",
    M24: "Attaque marquant le point directement ou qui empêche l’équipe adverse de renvoyer le ballon",
    M27: "Attaque renvoyée de l’autre côté du filet ne marquant pas de point ni ne faisant d’erreur et qui provoque une relance de l’équipe adverse",
    M28: "Attaque renvoyée de l’autre côté du filet ne marquant pas de point ni ne faisant d’erreur et qui provoque une attaque de l’équipe adverse",
    M29: "Attaque ratée qui est sortie ou dans le filet",
    K30: "Nombre d’attaques décisives par rapport au nombre total d’attaques réalisées",
  };
  const XL_PLAYER_MERGES = ["K3:L6", "K8:L10", "K11:M11", "K12:L14", "K15:M15", "M16:M18", "M19:M21", "K16:L22", "K23:M23",
    "K24:L29", "M24:M26", "K30:M30", "K32:K36", "M32:M34", "M35:M36", "B2:D2", "K2:M2", "B3:B6", "C3:D3", "C4:D4", "C5:D5",
    "K7:M7", "B11:D11", "C12:D12", "B12:B14", "B16:B22", "B24:B29", "B33:B36", "B37:B41", "C6:D6", "B7:D7", "B8:B10", "C8:D8",
    "C9:D9", "C10:D10", "B15:D15", "C27:D27", "C28:D28", "C29:D29", "B30:D30", "C13:D13", "C14:D14", "C16:C18",
    "C19:C21", "C22:D22", "B23:D23", "C24:C26", "L32:L34", "L35:L36", "K37:K41", "L37:L39", "M37:M39", "L40:L41", "M40:M41"];
  const PCT = (r) => (r == null ? "-" : { v: r, z: "0%" });
  /* Formules des feuilles joueurs de l’Excel du coach (X = colonne du set), recopiées à l’identique :
     une fiche collée dans son fichier garde des taux et des totaux qui se recalculent. */
  const XL_FORMULAS = {
    7: 'IF(SUM(X3:X6)=0,"-",X3/SUM(X3:X6))',
    11: 'IF((X8+X9+X10)=0,"-",X8/(X8+X9+X10))',
    15: 'IF((X12+X13+X14)=0,"-",X12/(X12+X13+X14))',
    23: 'IF((SUM(X16:X22))=0,"-",SUM(X16:X18)/(SUM(X16:X22)))',
    30: 'IF((SUM(X24:X29))=0,"-",SUM(X24:X26)/(SUM(X24:X29)))',
    33: "SUM(X24:X26)", 34: "X3", 35: "X8", 36: "SUM(X33:X35)",
    37: "X29", 38: "X6", 39: "X14", 40: "X22", 41: "SUM(X37:X40)",
  };
  const withFormula = (value, row, col) => {
    const f = XL_FORMULAS[row];
    if (!f) return value;
    const cell = typeof value === "object" && value ? Object.assign({}, value) : { v: value };
    cell.f = f.replace(/X(?=\d)/g, col);
    return cell;
  };
  function xlSheetName(name) {
    return String(name).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Joueur";
  }

  function playerSheetSpec(name, doc) {
    const c = Object.assign({ B2: name, E2: "SET 1", F2: "SET 2", G2: "SET 3", H2: "SET 4", I2: "SET 5", E32: "SET 1", F32: "SET 2", G32: "SET 3", H32: "SET 4", I32: "SET 5" }, XL_LABELS);
    const sets = setsArray(doc);
    sets.forEach((set, i) => {
      const col = SET_COLS[i];
      SKILLS.forEach((s) => {
        s.fields.forEach((f) => { const v = setVal(set, s.key, f.k); if (v && f.row) c[col + f.row] = v; });
        if (s.rateRow) c[col + s.rateRow] = withFormula(PCT(sumSkill([set], s.key).rate), s.rateRow, col);
      });
      const sl = scoreLine([set]);
      [[33, sl.pts.attaque], [34, sl.pts.service], [35, sl.pts.bloc], [36, sl.P],
        [37, sl.flt.attaque], [38, sl.flt.service], [39, sl.flt.reception], [40, sl.flt.passe], [41, sl.F]]
        .forEach(([row, v]) => { c[col + row] = withFormula(v, row, col); });
    });
    const b = (doc && doc.bilan) || {};
    c.M32 = b.pp || ""; c.M35 = b.pm || ""; c.M37 = b.cp || ""; c.M40 = b.cm || "";
    return { name, cells: c, merges: XL_PLAYER_MERGES,
      cols: [5, 22, 12, 12, 10, 10, 10, 10, 10, 4, 18, 12, 90] };
  }

  /* Fiche d’un seul joueur, à coller dans l’Excel du coach : sa feuille (même disposition) + un mode d’emploi. */
  function playerExportSpec(name, doc, match) {
    const tab = xlSheetName(name);
    const sheet = playerSheetSpec(tab, doc);
    Object.assign(sheet.cells, {
      B44: "À COLLER DANS L’EXCEL DU COACH, ONGLET « " + tab + " »",
      B45: "1) Stats : sélectionner E3:I30, copier, puis chez le coach cliquer sur E3 › Collage spécial › Formules.",
      B46: "2) Bilans : sélectionner M32:M41, copier, puis chez le coach cliquer sur M32 › Collage spécial › Formules.",
      B47: "Détails dans l’onglet « Mode d'emploi » et dans le Tuto de l’app.",
    });
    const when = match && match.date ? " du " + match.date.split("-").reverse().join("/") : "";
    const guide = {
      name: "Mode d'emploi",
      cols: [4, 120],
      cells: {
        B1: "Ajouter la fiche de " + name + " à l’Excel du coach",
        B2: "Match ASVP – " + ((match && match.opponent) || "") + when,
        B4: "1. Ouvre ce fichier et l’Excel du coach (sur Excel ou sur Google Sheets).",
        B5: "2. Ici, dans l’onglet « " + tab + " », sélectionne les cases E3 à I30 (tape E3:I30 dans la zone Nom, en haut à gauche, puis Entrée), puis copie (Ctrl+C).",
        B6: "3. Dans l’Excel du coach, ouvre l’onglet « " + tab + " » et clique sur la case E3.",
        B7: "4. Colle sans la mise en forme. Excel : clic droit › Collage spécial › Formules › OK. Google Sheets : clic droit › Collage spécial › Formule uniquement.",
        B8: "5. Recommence pour les bilans : copie les cases M32 à M41 ici, puis colle-les de la même façon en M32 dans l’onglet du coach.",
        B9: "6. Vérifie les onglets BILAN et STATS du coach : la ligne de " + name + " s’est remplie toute seule.",
        B11: "À éviter : un Ctrl+V simple, qui remplacerait les couleurs et les bordures du fichier du coach.",
        B12: "À éviter : renommer ou supprimer l’onglet du joueur chez le coach. Les feuilles BILAN et STATS le retrouvent par son nom.",
        B13: "Si l’onglet du coach contenait déjà des chiffres pour ce match, le collage les remplace.",
      },
    };
    return [sheet, guide];
  }

  /* players : [{ id, name, doc }] dans l’ordre de l’effectif. */
  function matchWorkbookSpec(match, players) {
    const sets = matchSets(match);
    const nSheetsSets = MAX_SETS;
    const head = { E2: "SET 1", F2: "SET 2", G2: "SET 3", H2: "SET 4", I2: "SET 5", J2: "TOTAL" };
    const per = players.map((p) => ({ p, sets: setsArray(p.doc) }));

    // BILAN
    const bil = { B2: "Joueur", C2: "Bilan personnel positif", D2: "Bilan personnel négatif" };
    let r = 3;
    per.forEach(({ p }) => { const b = (p.doc && p.doc.bilan) || {}; bil["B" + r] = p.name; bil["C" + r] = b.pp || ""; bil["D" + r] = b.pm || ""; r++; });
    r += 2;
    bil["B" + r] = "Joueur"; bil["C" + r] = "Bilan collectif positif"; bil["D" + r] = "Bilan collectif négatif"; r++;
    per.forEach(({ p }) => { const b = (p.doc && p.doc.bilan) || {}; bil["B" + r] = p.name; bil["C" + r] = b.cp || ""; bil["D" + r] = b.cm || ""; r++; });

    // STATS Points
    const sp = Object.assign({ C3: "ASVP", C4: "EQUIPE ADVERSE" }, head);
    let sa = 0, so = 0;
    for (let i = 0; i < nSheetsSets; i++) {
      const s = sets[i];
      if (s) { sp[SET_COLS[i] + 3] = s.a; sp[SET_COLS[i] + 4] = s.o; sa += s.a; so += s.o; }
    }
    if (sets.length) { sp.J3 = sa; sp.J4 = so; }
    r = 5;
    const block = (title, sub, valueOf, scoreRow) => {
      sp["C" + r] = title; r++;
      sp["C" + r] = sub;
      const start = r;
      const tot = [0, 0, 0, 0, 0];
      per.forEach(({ p, sets: ps }) => {
        sp["D" + r] = p.name;
        let t = 0;
        ps.forEach((set, i) => { const v = valueOf(set); sp[SET_COLS[i] + r] = v; tot[i] += v; t += v; });
        sp["J" + r] = t; r++;
      });
      sp["D" + r] = "TOTAL";
      tot.forEach((v, i) => { sp[SET_COLS[i] + r] = v; });
      sp["J" + r] = tot.reduce((a, b) => a + b, 0); r++;
      if (scoreRow && sets.length) {
        sp["C" + r] = "Écart avec le score (fautes adverses ou actions non saisies)";
        for (let i = 0; i < sets.length && i < nSheetsSets; i++) sp[SET_COLS[i] + r] = (scoreRow === "a" ? sets[i].a : sets[i].o) - tot[i];
        r++;
      }
      return start;
    };
    block("Points marqués par ASVP", "Tous points gagnants (attaques - services - blocs)", (set) => scoreLine([set]).P, "a");
    r++;
    block("Points perdus par ASVP", "Tous points perdus (attaques - services - réception - passes)", (set) => scoreLine([set]).F, "o");
    r++;
    block("Ratios joueur", "Différence entre points marqués et erreurs", (set) => scoreLine([set]).diff, null);
    r++;
    sp["C" + r] = "STATISTIQUE EQUIPE ADVERSE"; r++;
    const opp = (label, sub, key) => {
      sp["C" + r] = label; sp["D" + r] = sub;
      let t = 0;
      for (let i = 0; i < nSheetsSets; i++) {
        const v = opponentLine(per.map((x) => [x.sets[i]]))[key];
        sp[SET_COLS[i] + r] = v; t += v;
      }
      sp["J" + r] = t; r++;
    };
    opp("Après notre service", "Nombre de relances", "srvRel");
    opp("", "Nombre d’attaques", "srvAtt");
    opp("Après notre attaque", "Nombre de relances", "attRel");
    opp("", "Nombre d’attaques", "attAtt");

    // STATS Taux de transformation (total pondéré par le nombre de gestes)
    const st = Object.assign({}, head);
    r = 3;
    ["service", "reception", "passe", "attaque", "bloc"].forEach((sk) => {
      const s = SKILL[sk];
      st["C" + r] = "Taux de transformation " + (sk === "attaque" ? "des attaques" : sk === "reception" ? "des réceptions" : sk === "bloc" ? "des blocs" : "des " + s.label.toLowerCase() + "s");
      st["D" + r] = s.rateText; r++;
      per.forEach(({ p, sets: ps }) => {
        st["D" + r] = p.name;
        ps.forEach((set, i) => { st[SET_COLS[i] + r] = PCT(sumSkill([set], sk).rate); });
        st["J" + r] = PCT(sumSkill(ps, sk).rate); r++;
      });
      r++;
    });

    const sheets = [
      { name: "BILAN", cells: bil, cols: [5, 20, 70, 70] },
      { name: "STATS Points", cells: sp, cols: [4, 4, 30, 22, 10, 10, 10, 10, 10, 10] },
      { name: "STATS Taux de transformation", cells: st, cols: [4, 4, 34, 40, 10, 10, 10, 10, 10, 10] },
    ];
    const used = new Set(sheets.map((s) => s.name.toLowerCase()));
    players.forEach((p) => {
      let n = xlSheetName(p.name);
      let k = 2;
      while (used.has(n.toLowerCase())) n = n.slice(0, 28) + " " + k++;
      used.add(n.toLowerCase());
      sheets.push(playerSheetSpec(n, p.doc));
    });
    return sheets;
  }

  /* matches : [{ match, players: [{ id, name, doc }] }] trié par date. */
  function seasonWorkbookSpec(entries, roster) {
    const ms = { A1: "Date", B1: "Adversaire", C1: "Lieu", D1: "Compétition", E1: "Résultat", F1: "Score des sets", G1: "Joueurs ayant saisi" };
    entries.forEach((e, i) => {
      const r = i + 2, m = e.match, res = matchResult(m);
      ms["A" + r] = m.date || ""; ms["B" + r] = m.opponent || ""; ms["C" + r] = m.venue === "dom" ? "Domicile" : m.venue === "ext" ? "Extérieur" : "";
      ms["D" + r] = m.competition || ""; ms["E" + r] = res ? res.a + "-" + res.o : "";
      ms["F" + r] = matchSets(m).map((s) => s.a + "-" + s.o).join(" / ");
      ms["G" + r] = e.players.filter((p) => isFilled(p.doc)).length;
    });
    const heads = ["Joueur", "Matchs saisis", "Points", "dont attaque", "dont service", "dont bloc", "Fautes", "+/-",
      "Taux service", "Taux réception", "Taux passe", "Taux attaque", "Taux bloc"];
    const tot = {};
    const cols = "ABCDEFGHIJKLM";
    heads.forEach((h, i) => { tot[cols[i] + 1] = h; });
    roster.forEach((pl, i) => {
      const r = i + 2;
      const all = [];
      let n = 0;
      entries.forEach((e) => { const p = e.players.find((x) => x.id === pl.id); if (p && isFilled(p.doc)) { n++; all.push.apply(all, setsArray(p.doc)); } });
      const sl = scoreLine(all);
      const row = [pl.name, n, sl.P, sl.pts.attaque, sl.pts.service, sl.pts.bloc, sl.F, sl.diff,
        PCT(sumSkill(all, "service").rate), PCT(sumSkill(all, "reception").rate), PCT(sumSkill(all, "passe").rate),
        PCT(sumSkill(all, "attaque").rate), PCT(sumSkill(all, "bloc").rate)];
      row.forEach((v, j) => { tot[cols[j] + r] = v; });
    });
    const det = {};
    const fieldCols = [];
    SKILLS.forEach((s) => s.fields.forEach((f) => fieldCols.push({ s, f })));
    const colName = (i) => { let n = "", x = i + 1; while (x > 0) { const m = (x - 1) % 26; n = String.fromCharCode(65 + m) + n; x = Math.floor((x - 1) / 26); } return n; };
    ["Date", "Adversaire", "Joueur", "Set"].concat(fieldCols.map(({ s, f }) => s.label + " " + f.label.toLowerCase() + (f.p ? " P" + f.p : "")))
      .forEach((h, i) => { det[colName(i) + 1] = h; });
    let r = 2;
    entries.forEach((e) => e.players.forEach((p) => setsArray(p.doc).forEach((set, si) => {
      if (!set || !countActions(set)) return;
      det["A" + r] = e.match.date || ""; det["B" + r] = e.match.opponent || ""; det["C" + r] = p.name; det["D" + r] = si + 1;
      fieldCols.forEach(({ s, f }, j) => { det[colName(4 + j) + r] = setVal(set, s.key, f.k); });
      r++;
    })));
    return [
      { name: "Matchs", cells: ms, cols: [12, 22, 12, 22, 10, 26, 18] },
      { name: "Totaux saison", cells: tot, cols: [18, 12, 8, 12, 12, 10, 8, 6, 12, 14, 11, 12, 10] },
      { name: "Détail par set", cells: det },
    ];
  }

  const api = {
    MAX_SETS, SET_COLS, setReferential,
    norm, slug, uid, clone, statId, setVal, setsArray, sumSkill, scoreLine, countActions, hasBilan, isFilled,
    opponentLine, matchSets, matchResult, matchSetCount, seasonOf,
    parseWorkbookData, playerSheetSpec, playerExportSpec, matchWorkbookSpec, seasonWorkbookSpec,
  };
  Object.defineProperties(api, {
    SKILLS: { get: () => SKILLS }, SKILL: { get: () => SKILL }, LEVELS: { get: () => LEVELS },
    ROLES: { get: () => ROLES }, POSTES: { get: () => POSTES },
  });
  root.StatorCore = api;
})(typeof window !== "undefined" ? window : globalThis);
