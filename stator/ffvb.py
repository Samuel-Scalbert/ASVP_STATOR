"""Championnat FFVolley : lit la poule de l'équipe sur le site de la fédération et l'envoie à l'app.

Le serveur PythonAnywhere gratuit ne peut pas joindre ffvbbeach.org (le site n'est pas dans sa liste
de sites autorisés) et la page de l'app non plus (le site n'accepte pas les requêtes venant d'autres
sites). Ce module tourne donc ailleurs : chaque matin sur GitHub Actions
(.github/workflows/championnat.yml), ou à la main depuis un PC. Il n'utilise que la bibliothèque standard :

    python stator/ffvb.py --app https://samuelscalbert.eu.pythonanywhere.com

Il lit la page de la poule (matchs, scores des sets, salles), la poule de la saison précédente, et la
fiche PDF des prochains matchs de l'équipe (adresse de la salle, couleurs des maillots), puis remplace
les données du championnat dans l'app (PUT /api/league). Rien d'autre n'est gardé : ni pages, ni PDF,
ni coordonnées. Le classement et les statistiques sont recalculés par la page à partir des scores.
Après chaque match joué de l'équipe, il lit aussi la feuille de match électronique (effectifs avec numéros,
noms et licences, libéros, encadrement, horaires et service de chaque set) et l'envoie une seule fois
(PUT /api/league/sheets/<code>) ; une feuille pas encore remplie est relue les jours suivants.
Les corrections saisies par l'équipe (horaire, salle, rendez-vous) sont rangées à part dans l'app et
survivent à l'actualisation ; dès que le site affiche la même chose, l'app retire la correction.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import date, datetime, timezone

BASE = "https://www.ffvbbeach.org/ffvbapp"
DEFAULT_POOL = BASE + "/resu/vbspo_calendrier.php?saison=2026/2027&codent=PTIDF75&poule=ARM"
DEFAULT_TEAM = "ASVP"
USER_AGENT = "ASVP-Stator (statistiques d'une equipe de volley)"
CODE_RE = re.compile(r"^[A-Z0-9]{2,8}\d{3}$")
SETS_RE = re.compile(r"^\d{1,2}:\d{1,2}(?:\s*,\s*\d{1,2}:\d{1,2})*$")


class FfvbError(Exception):
    """Le site FFVolley n'a pas répondu ce qu'on attendait."""


# ---------------------------------------------------------------- accès au site
def fetch(url: str, form: dict | None = None) -> bytes:
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read()
    except (urllib.error.URLError, TimeoutError) as e:
        raise FfvbError(f"site FFVolley injoignable ({e})") from e


def parse_source(url: str) -> dict:
    """Adresse de la page d'une poule -> {"season", "codent", "poule"}."""
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    src = {k: (qs.get(k) or [""])[0] for k in ("saison", "codent", "poule")}
    if not all(src.values()):
        raise FfvbError("adresse de poule incomplète : il faut saison, codent et poule.")
    return {"season": src["saison"], "codent": src["codent"], "poule": src["poule"]}


def pool_url(src: dict) -> str:
    return (f"{BASE}/resu/vbspo_calendrier.php?saison={src['season']}&codent={src['codent']}"
            f"&poule={src['poule']}&calend=COMPLET")


def season_of(day: date) -> str:
    """Saison sportive d'une date : de septembre à août."""
    y = day.year if day.month >= 8 else day.year - 1
    return f"{y}/{y + 1}"


def previous_season(season: str) -> str:
    y = int(season.split("/")[0])
    return f"{y - 1}/{y}"


# ---------------------------------------------------------------- page de la poule
def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"(?s)<[^>]+>", " ", fragment))).strip()


def _rows(page: str) -> list[tuple[str, list[str]]]:
    page = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page)
    return [(row, [_text(c) for c in re.findall(r"(?is)<td\b[^>]*>(.*?)</td>", row)])
            for row in re.findall(r"(?is)<tr\b[^>]*>(.*?)</tr>", page)]


def _iso(day: str) -> str:
    m = re.match(r"^(\d{2})/(\d{2})/(\d{2})$", day)
    return f"20{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def parse_pool(page: str, poule: str) -> dict:
    """Matchs (avec scores des sets), points du classement officiel et site de chaque équipe."""
    title = re.search(r">\s*(" + re.escape(poule) + r" - [^<]{4,160}?)\s*<", page)
    out = {"title": _text(title.group(1)) if title else poule, "matches": [], "official": {}, "sites": {}}
    rnd = 0
    for raw, cells in _rows(page):
        if not cells:
            continue
        j = re.match(r"^Journ\S*e\s+(\d+)$", cells[0])
        if j:
            rnd = int(j.group(1))
            continue
        if CODE_RE.match(cells[0]) and len(cells) >= 6:
            home, away = cells[3], cells[5]
            if not home or not away or "xxxxx" in (home, away):
                continue  # équipe exempte cette journée
            after = cells[6:]
            sets_cell = next((c for c in after if SETS_RE.match(c)), "")
            sets = [[int(a), int(b)] for a, b in re.findall(r"(\d+):(\d+)", sets_cell)]
            m = {"code": cells[0], "round": rnd, "date": _iso(cells[1]), "time": cells[2] if re.match(r"^\d{2}:\d{2}$", cells[2]) else "",
                 "home": home, "away": away, "sets": sets}
            gym = next((c for c in after if c), "") if not sets else ""
            if gym:
                m["gym"] = gym
            out["matches"].append(m)
        elif re.match(r"^\d+\.$", cells[0]) and len(cells) >= 19:
            team = cells[1]
            try:
                out["official"][team] = int(cells[2] or 0)
            except ValueError:
                pass
            site = re.search(r"""href=['"]((?:https?:)?//[^'"]+)['"]""", raw)
            if site:
                url = site.group(1)
                out["sites"][team] = "https:" + url if url.startswith("//") else url
    return out


def points(won: int, lost: int) -> int:
    """Barème FFVolley : 3 points pour 3-0 ou 3-1, 2 pour 3-2, 1 pour 2-3, 0 sinon."""
    if won > lost:
        return 3 if lost <= 1 else 2
    return 1 if won == 2 else 0


def table_points(matches: list[dict]) -> dict[str, int]:
    pts: dict[str, int] = {}
    for m in matches:
        pts.setdefault(m["home"], 0)
        pts.setdefault(m["away"], 0)
        if m["sets"]:
            h = sum(a > b for a, b in m["sets"])
            a = sum(b > a for a, b in m["sets"])
            pts[m["home"]] += points(h, a)
            pts[m["away"]] += points(a, h)
    return pts


def adjustments(pool: dict) -> dict[str, int]:
    """Écart entre le classement officiel et le barème (forfaits, pénalités) : seul cet écart est gardé."""
    computed = table_points(pool["matches"])
    return {t: p - computed.get(t, 0) for t, p in pool["official"].items() if p != computed.get(t, 0)}


# ---------------------------------------------------------------- fiche d'un match (PDF)
_TJ = re.compile(rb"\(((?:\\.|[^\\)])*)\)\s*Tj")


def _pdf_string(b: bytes) -> str:
    out, i = bytearray(), 0
    while i < len(b):
        if b[i] == 0x5C and i + 1 < len(b):  # séquence d'échappement
            n = b[i + 1]
            if 0x30 <= n <= 0x37:
                k = i + 1
                while k < len(b) and k < i + 4 and 0x30 <= b[k] <= 0x37:
                    k += 1
                out.append(int(b[i + 1:k], 8) & 0xFF)
                i = k
                continue
            out.append({0x6E: 10, 0x72: 13, 0x74: 9}.get(n, n))
            i += 2
            continue
        out.append(b[i])
        i += 1
    return out.decode("cp1252", errors="replace")


def pdf_lines(data: bytes) -> list[str]:
    """Texte des PDF du site FFVolley (FPDF : flux compressés, une chaîne par opérateur Tj)."""
    lines = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            raw = zlib.decompress(m.group(1))
        except zlib.error:
            continue  # image ou flux non compressé
        lines += [_pdf_string(t) for t in _TJ.findall(raw)]
    return lines


def parse_fiche(lines: list[str]) -> dict:
    """Salle du match (nom, adresse) et, pour chaque équipe dans l'ordre domicile puis extérieur,
    le nom du club et les couleurs des maillots. Les coordonnées des personnes sont ignorées."""
    lines = [re.sub(r"\s+", " ", x).strip() for x in lines]
    lines = [x for x in lines if x]
    out: dict = {"gym": None, "teams": []}
    if "Salle" in lines:
        i, block = lines.index("Salle") + 1, []
        while i < len(lines) and not lines[i].startswith("Arbitre"):
            block.append(lines[i])
            i += 1
        if block:
            out["gym"] = {"name": block[0], "address": ", ".join(block[1:])}
    for i, x in enumerate(lines):
        m = re.match(r"^Couleurs\s*:\s*(.*)$", x)
        if m and i >= 3 and re.match(r"^\d+ - \d+$", lines[i - 2]):
            colors = re.split(r"\s+-\s+", m.group(1))[0].strip()
            out["teams"].append({"club": lines[i - 3].replace("_", " "), "colors": colors})
    return out


# ---------------------------------------------------------------- feuille de match électronique (après le match)
_TD_TJ = re.compile(rb"BT\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s+\(((?:\\.|[^\\)])*)\)\s*Tj")


def pdf_items(data: bytes) -> list[tuple[float, float, str]]:
    """Textes d'un PDF FPDF avec leur position (x, y) : la feuille de match est un tableau, l'ordre ne suffit pas."""
    out = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            raw = zlib.decompress(m.group(1))
        except zlib.error:
            continue
        for t in _TD_TJ.finditer(raw):
            s = re.sub(r"\s+", " ", _pdf_string(t.group(3))).strip()
            if s:
                out.append((float(t.group(1)), float(t.group(2)), s))
    return out


def _at(items, x: float, y: float, dx: float = 4, dy: float = 1.5) -> str:
    return next((s for ix, iy, s in items if abs(ix - x) <= dx and abs(iy - y) <= dy), "")


def _minutes(text: str) -> int:
    m = re.match(r"^(\d{1,3})'$", text or "")
    return int(m.group(1)) if m else 0


def parse_fdme(data: bytes) -> dict | None:
    """Feuille de match électronique FFVolley -> équipes (A à gauche, B à droite), horaires, sets
    (service en premier, durée, temps morts et remplacements comptés) et effectifs (numéro, nom, licence,
    libéros, encadrement). Renvoie None si la feuille n'est pas encore remplie."""
    if not data.startswith(b"%PDF"):
        return None
    it = pdf_items(data)
    # En-têtes « Licence » des deux effectifs : la seule paire à la même hauteur (les arbitres en ont un aussi).
    allc = [(x, y) for x, y, s in it if s == "Licence"]
    lic = next((sorted([p, q], key=lambda v: v[0]) for i, p in enumerate(allc) for q in allc[i + 1:] if abs(p[1] - q[1]) < 1), None)
    if not lic:
        return None
    head_y = lic[0][1]
    cols = []  # colonnes des effectifs : (x du numéro, x du nom, x de la licence)
    for lx, _ in lic:
        num_x = max((x for x, y, s in it if s.startswith("N") and len(s) <= 3 and abs(y - head_y) < 1 and x < lx), default=None)
        name_x = next((x for x, y, s in it if s.startswith("Nom") and abs(y - head_y) < 1 and num_x is not None and num_x < x < lx), None)
        if num_x is None or name_x is None:
            return None
        cols.append((num_x, name_x, lx))
    names = [_at(it, c[0], head_y + 11, dx=3, dy=2) for c in cols]
    if not all(names):
        return None
    lib_y = next((y for x, y, s in it if s == "LIBEROS" and y < head_y), None)
    cap_y = next((y for x, y, s in it if s == "Capitaine" and y < head_y), 0)
    rosters = []
    for num_x, name_x, lic_x in cols:
        players, staff = [], []
        for x, y, s in sorted(it, key=lambda i: -i[1]):
            if abs(x - num_x) > 3 or not (cap_y < y < head_y - 3):
                continue
            name, licence = _at(it, name_x, y, dx=3), _at(it, lic_x, y, dx=6)
            if re.fullmatch(r"\d{1,2}", s) and name:
                row = {"num": s, "name": name[:60], "lic": licence if re.fullmatch(r"\d{4,10}", licence) else ""}
                if lib_y is not None and y < lib_y:
                    for p in players:  # les libéros sont aussi dans la liste : on les marque
                        if p["num"] == s:
                            p["libero"] = True
                else:
                    players.append(row)
            elif re.fullmatch(r"[A-Z]{1,3}", s) and name and lib_y is not None and y < lib_y:
                staff.append({"role": s, "name": name[:60], "lic": licence if re.fullmatch(r"\d{4,10}", licence) else ""})
        rosters.append({"players": players[:30], "staff": staff[:6]})
    if not rosters[0]["players"] and not rosters[1]["players"]:
        return None

    # Tableau « Résultats » : T R G P (équipe A) | set | durée | P G R T (équipe B).
    sets = []
    hdr = [(x, y, s) for x, y, s in it if s in ("T", "R", "G", "P") and 380 < x < 600]
    rows_y = sorted({round(y, 1) for x, y, s in hdr})
    head = next((y for y in rows_y if len([1 for x, yy, s in hdr if abs(yy - y) < 0.5]) == 8), None)
    if head is not None:
        hx = sorted(x for x, y, s in hdr if abs(y - head) < 0.5)
        mid = (hx[3] + hx[4]) / 2
        for x, y, s in sorted(it, key=lambda i: -i[1]):
            if abs(x - mid + 10) > 12 or not (head - 50 < y < head - 2) or not re.fullmatch(r"[1-5]", s):
                continue
            val = lambda cx: _at(it, cx, y, dx=3)
            num = lambda cx: int(val(cx)) if val(cx).isdigit() else 0
            sets.append({"n": int(s), "min": _minutes(next((t for ix, iy, t in it if abs(iy - y) < 1 and mid < ix < hx[4] and t.endswith("'")), "")),
                         "a": {"pts": num(hx[3]), "to": num(hx[0]), "subs": num(hx[1])},
                         "b": {"pts": num(hx[4]), "to": num(hx[7]), "subs": num(hx[6])}})
    # Cadres de chaque set : « Début: 19:27 R » après l'équipe de gauche, « Fin: 20:02 S » après celle de droite.
    starts = sorted([(x, y, s) for x, y, s in it if s.startswith("D") and "but:" in s], key=lambda i: (-round(i[1]), i[0]))
    n = 0
    for x, y, s in starts:
        n += 1
        m = re.search(r"(\d{2}:\d{2})\s*([SR])?$", s)
        end = next((t for ix, iy, t in sorted(it, key=lambda i: i[0]) if t.startswith("Fin:") and abs(iy - y) < 1 and ix > x), "")
        left = max(((ix, t) for ix, iy, t in it if t in names and abs(iy - y) < 1 and ix < x), default=(0, ""))[1]
        st = next((d for d in sets if d["n"] == n), None)
        if st is None or not m:
            continue
        st["start"] = m.group(1)
        me = re.search(r"(\d{2}:\d{2})", end)
        st["end"] = me.group(1) if me else ""
        if m.group(2) and left:
            serves_left = m.group(2) == "S"
            st["serve"] = ("a" if left == names[0] else "b") if serves_left else ("b" if left == names[0] else "a")
    sets = [d for d in sets if d["a"]["pts"] or d["b"]["pts"]]
    # Horaires du match : sous le libellé « Fin » du tableau des résultats.
    fin = next(((x, y) for x, y, s in it if s == "Fin" and head is not None and y < head - 40), None)
    start = end = ""
    if fin:
        vals = sorted([(x, s) for x, y, s in it if fin[1] - 12 < y < fin[1] - 2 and re.fullmatch(r"\d{2}:\d{2}", s)])
        if len(vals) >= 2:
            start, end = vals[0][1], vals[1][1]
    return {"a": names[0], "b": names[1], "start": start, "end": end,
            "min": sum(d["min"] for d in sets), "sets": sets, "rosters": {"a": rosters[0], "b": rosters[1]}}


def fetch_fdme(src: dict, code: str) -> dict | None:
    url = (f"{BASE}/resu/ffvolley_fdme.php?saison={urllib.parse.quote(src['season'])}"
           f"&codent={src['codent']}&codmatch={code}")
    return parse_fdme(fetch(url, {}))


def fetch_fiche(src: dict, code: str) -> dict:
    data = fetch(f"{BASE}/adressier/fiche_match_ffvb.php",
                 {"wss_saison": src["season"], "codmatch": code, "codent": src["codent"]})
    if not data.startswith(b"%PDF"):
        raise FfvbError(f"fiche du match {code} introuvable")
    return parse_fiche(pdf_lines(data))


# ---------------------------------------------------------------- document envoyé à l'app
def collect(src: dict, team: str, known: dict | None = None, max_fiches: int = 6, log=print) -> dict:
    known = known or {}
    pool = parse_pool(fetch(pool_url(src)).decode("cp1252", errors="replace"), src["poule"])
    if not pool["matches"]:
        raise FfvbError(f"aucun match dans la poule {src['poule']} ({src['season']}) : vérifie l'adresse.")
    teams_now = {t for m in pool["matches"] for t in (m["home"], m["away"])}
    if team not in teams_now:
        raise FfvbError(f"l'équipe « {team} » n'est pas dans cette poule : {', '.join(sorted(teams_now))}.")

    previous = None
    prev_src = dict(src, season=previous_season(src["season"]))
    try:
        prev = parse_pool(fetch(pool_url(prev_src)).decode("cp1252", errors="replace"), src["poule"])
        if prev["matches"]:
            previous = {"season": prev_src["season"], "title": prev["title"], "matches": prev["matches"],
                        "adjust": adjustments(prev)}
    except FfvbError as e:
        log(f"Saison précédente non lue : {e}")

    # Infos des fiches déjà connues, limitées aux équipes et aux salles encore utiles (pas d'accumulation).
    teams = {t: {k: v for k, v in info.items() if k in ("club", "colors")}
             for t, info in (known.get("teams") or {}).items() if t in teams_now}
    for t, url in pool["sites"].items():
        if t in teams_now:
            teams.setdefault(t, {})["site"] = url
    gyms_needed = {m["gym"] for m in pool["matches"] if m.get("gym")}
    gyms = {g: a for g, a in (known.get("gyms") or {}).items() if g in gyms_needed}

    today = date.today().isoformat()
    todo = [m for m in pool["matches"]
            if team in (m["home"], m["away"]) and not m["sets"] and m["date"] >= today
            and ((m.get("gym") and m["gym"] not in gyms)
                 or "colors" not in teams.get(m["away"] if m["home"] == team else m["home"], {}))]
    for m in todo[:max_fiches]:
        try:
            fiche = fetch_fiche(src, m["code"])
        except FfvbError as e:
            log(f"Fiche {m['code']} non lue : {e}")
            continue
        if fiche["gym"] and fiche["gym"]["address"]:
            gyms[fiche["gym"]["name"]] = fiche["gym"]["address"]
        for name, info in zip((m["home"], m["away"]), fiche["teams"]):
            teams.setdefault(name, {}).update(info)
        time.sleep(1)  # une requête à la fois, pour ménager le site de la fédération

    return {
        "source": src, "title": pool["title"], "team": team,
        "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "matches": pool["matches"], "adjust": adjustments(pool),
        "teams": {t: v for t, v in teams.items() if v}, "gyms": gyms, "previous": previous,
    }


def collect_sheets(src: dict, team: str, matches: list[dict], have: set, max_sheets: int = 8, log=print) -> dict:
    """Feuilles de match des matchs joués de l'équipe qui ne sont pas encore dans l'app."""
    out = {}
    todo = [m for m in matches if team in (m["home"], m["away"]) and m["sets"] and m["code"] not in have]
    for m in todo[:max_sheets]:
        try:
            sheet = fetch_fdme(src, m["code"])
        except FfvbError as e:
            log(f"Feuille de match {m['code']} non lue : {e}")
            continue
        if sheet:
            out[m["code"]] = sheet
        else:
            log(f"Feuille de match {m['code']} pas encore remplie sur le site.")
        time.sleep(1)
    return out


def _json(url: str, method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        if e.code == 404:
            detail = "le serveur ne connaît pas encore le championnat : mets l'app à jour (version 1.6.0 ou plus)."
        raise FfvbError(f"l'app a répondu {e.code} : {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise FfvbError(f"app injoignable ({e})") from e


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python stator/ffvb.py",
                                description="Met à jour le championnat FFVolley dans l'app ASVP Stator.")
    p.add_argument("--app", default=os.environ.get("STATOR_URL") or "http://127.0.0.1:5000",
                   help="adresse de l'app (par défaut : variable STATOR_URL, sinon http://127.0.0.1:5000)")
    p.add_argument("--poule", help="adresse de la page de la poule sur le site FFVolley (sinon : celle déjà connue de l'app)")
    p.add_argument("--equipe", help="nom de l'équipe dans la poule (sinon : celui déjà connu de l'app, ou ASVP)")
    p.add_argument("--essai", action="store_true", help="affiche ce qui serait envoyé, sans rien envoyer")
    args = p.parse_args(argv)
    app = args.app.rstrip("/")
    try:
        try:
            known = _json(app + "/api/state").get("league") or {}
        except FfvbError as e:
            if not args.essai:
                raise
            print(f"(essai) {e}")
            known = {}
        if args.poule:
            src = parse_source(args.poule)
        else:
            src = known.get("source") or parse_source(DEFAULT_POOL)
            now = season_of(date.today())
            if src["season"] != now:  # nouvelle saison : même poule, si elle existe déjà
                cand = dict(src, season=now)
                if parse_pool(fetch(pool_url(cand)).decode("cp1252", errors="replace"), cand["poule"])["matches"]:
                    src = cand
                else:
                    print(f"La poule {src['poule']} n'existe pas encore pour {now} : on garde {src['season']}.")
        team = args.equipe or known.get("team") or DEFAULT_TEAM
        doc = collect(src, team, known)
        sheets = collect_sheets(src, team, doc["matches"], set(known.get("sheets") or []))
        played = sum(1 for m in doc["matches"] if m["sets"])
        print(f"{doc['title']} ({src['season']}) : {len(doc['matches'])} matchs dont {played} joués, "
              f"{len(doc['gyms'])} salles, {len(doc['teams'])} équipes.")
        if args.essai:
            size = len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode())
            print(f"(essai) rien n'est envoyé ; taille du document : {size / 1024:.1f} Ko.")
            for code, sh in sheets.items():
                print(f"(essai) feuille {code} : {sh['a']} – {sh['b']}, {len(sh['sets'])} sets, "
                      f"{len(sh['rosters']['a']['players'])} + {len(sh['rosters']['b']['players'])} joueurs.")
            return 0
        res = _json(app + "/api/league", "PUT", doc)
        print(f"Championnat mis à jour dans l'app : {app}")
        # Les corrections de l'équipe (horaire, salle) sont gardées par l'app ; celles que le site reprend sont retirées.
        for code in res.get("confirmed") or []:
            print(f"Match {code} : le site FFVolley affiche maintenant la date, l'heure et la salle corrigées par l'équipe.")
        for code, sh in sheets.items():
            _json(f"{app}/api/league/sheets/{code}", "PUT", sh)
            print(f"Feuille de match {code} ajoutée : {sh['a']} – {sh['b']}.")
        return 0
    except FfvbError as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
