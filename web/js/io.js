/* ASVP Stator — fichiers Excel : lecture d’un ancien match, export au format habituel. */
(function (root) {
  "use strict";
  const C = root.StatorCore;
  const { store, q } = root.StatorStore;
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  let loading = null;

  function loadXLSX() {
    if (root.XLSX) return Promise.resolve(root.XLSX);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = XLSX_URL;
        s.onload = () => (root.XLSX ? resolve(root.XLSX) : reject(new Error("xlsx")));
        s.onerror = () => { loading = null; reject(new Error("xlsx")); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  function specToWorkbook(X, spec) {
    const wb = X.utils.book_new();
    spec.forEach((sh) => {
      const ws = {};
      let maxR = 0, maxC = 0;
      Object.keys(sh.cells).forEach((ref) => {
        const raw = sh.cells[ref];
        if (raw === "" || raw == null) return;
        let cell;
        if (typeof raw === "object") cell = { t: "n", v: raw.v, z: raw.z };
        else if (typeof raw === "number") cell = { t: "n", v: raw };
        else cell = { t: "s", v: String(raw) };
        ws[ref] = cell;
        const a = X.utils.decode_cell(ref);
        if (a.r > maxR) maxR = a.r;
        if (a.c > maxC) maxC = a.c;
      });
      ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
      if (sh.merges) ws["!merges"] = sh.merges.map((m) => X.utils.decode_range(m));
      if (sh.cols) ws["!cols"] = sh.cols.map((w) => ({ wch: w }));
      X.utils.book_append_sheet(wb, ws, sh.name);
    });
    return wb;
  }

  /* Résout « saved » / « declined » / « failed » ; jamais d’exception. */
  async function saveFile(filename, blob) {
    let dl = null;
    try { if (root.claude && typeof root.claude.use === "function") dl = await root.claude.use("downloads"); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: blob }); return "saved"; }
      catch (e) { return e && e.code === "declined" ? "declined" : "failed"; }
    }
    if (root.claude) return "failed"; // dans le lecteur, un lien de téléchargement serait bloqué
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return "saved";
    } catch (e) { return "failed"; }
  }
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

  async function exportMatch(m) {
    const X = await loadXLSX();
    const wb = specToWorkbook(X, C.matchWorkbookSpec(m, q.playersOf(m.id)));
    const buf = X.write(wb, { bookType: "xlsx", type: "array" });
    return saveFile("ASVP - " + safeName(m.opponent || "match") + ".xlsx", new Blob([buf], { type: XLSX_MIME }));
  }
  async function exportSeason() {
    const X = await loadXLSX();
    const entries = q.matchList().slice().reverse().map((m) => ({ match: m, players: q.playersOf(m.id) }));
    const wb = specToWorkbook(X, C.seasonWorkbookSpec(entries, q.roster()));
    const buf = X.write(wb, { bookType: "xlsx", type: "array" });
    const season = (store.config && store.config.season) || "saison";
    return saveFile("ASVP - Stats " + safeName(season) + ".xlsx", new Blob([buf], { type: XLSX_MIME }));
  }
  async function readWorkbookFile(file) {
    const X = await loadXLSX();
    const wb = X.read(await file.arrayBuffer(), { type: "array" });
    const cell = (sn, ref) => {
      const ws = wb.Sheets[sn];
      const c = ws && ws[ref];
      if (!c || c.t === "e") return undefined;
      return c.v;
    };
    return C.parseWorkbookData(wb.SheetNames, cell, file.name);
  }

  root.StatorIO = { loadXLSX, exportMatch, exportSeason, readWorkbookFile };
})(window);
