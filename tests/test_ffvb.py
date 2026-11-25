"""Championnat FFVolley : lecture de la poule et des fiches (pages fictives), stockage dans l'app."""
import zlib
from datetime import date, timedelta

from stator import ffvb

SOON = (date.today() + timedelta(days=5)).strftime("%d/%m/%y")


def row(*cells: str) -> str:
    return "<tr>" + "".join(f"<td class='liengris_pt'>{c}</td>" for c in cells) + "</tr>"


# Même structure que la page du site (journées, matchs joués, à venir, exempt, classement), équipes fictives.
POOL = f"""<html><body><table>
<tr><td class='titre'>ABC - CHAMPIONNAT TEST MASCULIN</td></tr>
{row("1.", "EQUIPE A", "3", "1", "1", "", "", "1", "", "", "", "", "", "3", "1", "3.000", "100", "80", "1.250")}
{row("2.", "NOUS", "0", "1", "", "1", "", "", "", "", "", "1", "", "1", "3", "0.333", "80", "100", "0.800")
   .replace("</tr>", "<td><a href='//club-nous.example' class='lienquestion'>site</a></td></tr>")}
{row("3.", "EQUIPE C", "0", "0", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "")}
{row("Journ&eacute;e 01")}
{row("ABCA001", "03/10/26", "20:00", "EQUIPE A", "<img src='ballon.jpg'>", "NOUS", "3", "1", "25:20, 18:25, 25:15, 32:30", "100-080", "ARBITRE X")}
{row("ABCA002", "", "", "xxxxx", "<img src='ballon.jpg'>", "EQUIPE C", "", "", "")}
{row("Journ&eacute;e 02")}
<tr><td>ABCA003</td><td>{SOON}</td><td>18:30</td><td>NOUS</td><td><img src='ballon.jpg'></td><td>EQUIPE C</td>
<form method=post action=../adressier/fiche_match_ffvb.php><td>GYMNASE TEST <input type='image'></td></form><td></td><td></td></tr>
</table></body></html>"""


def fpdf(*texts: str) -> bytes:
    """Petit PDF au format du site (FPDF) : un flux compressé, une chaîne par opérateur Tj."""
    content = "".join("BT (%s) Tj ET\n" % t.replace("(", "\\(").replace(")", "\\)") for t in texts)
    stream = zlib.compress(content.encode("cp1252"))
    return b"%PDF-1.4\n1 0 obj << /Filter /FlateDecode >>\nstream\n" + stream + b"\nendstream\nendobj\n%%EOF"


FICHE = fpdf("2026/2027", "Match: ABCA003", "Salle", "", "GYMNASE TEST", "1 RUE DU SPORT", "75000 PARIS",
             "Arbitre.s", "", "CLUB NOUS", "4 - 0750000", "Ligue ILE-DE-FRANCE",
             "Couleurs : NOIR ET BLEU   -   M. PRESIDENT (Pdt)", "Correspondant :", "M. PERSONNE", "06 00 00 00 00",
             "CLUB C", "2 - 0750001", "Ligue ILE-DE-FRANCE", "Couleurs : ROUGE   -   MME PRESIDENTE (Pdt)")


def test_pool_page_is_read():
    pool = ffvb.parse_pool(POOL, "ABC")
    assert pool["title"] == "ABC - CHAMPIONNAT TEST MASCULIN"
    assert [m["code"] for m in pool["matches"]] == ["ABCA001", "ABCA003"]  # l'exempt est ignoré
    played, coming = pool["matches"]
    assert played == {"code": "ABCA001", "round": 1, "date": "2026-10-03", "time": "20:00", "home": "EQUIPE A",
                      "away": "NOUS", "sets": [[25, 20], [18, 25], [25, 15], [32, 30]]}  # pas d'arbitre gardé
    assert coming["round"] == 2 and coming["sets"] == [] and coming["gym"] == "GYMNASE TEST"
    assert pool["official"] == {"EQUIPE A": 3, "NOUS": 0, "EQUIPE C": 0}
    assert pool["sites"] == {"NOUS": "https://club-nous.example"}
    assert ffvb.adjustments(pool) == {}
    pool["official"]["NOUS"] = -1  # pénalité : seul l'écart avec le barème est gardé
    assert ffvb.adjustments(pool) == {"NOUS": -1}


def test_points_scale():
    assert [ffvb.points(3, 0), ffvb.points(3, 1), ffvb.points(3, 2), ffvb.points(2, 3), ffvb.points(1, 3)] == [3, 3, 2, 1, 0]


def test_match_card_keeps_gym_and_colors_only():
    fiche = ffvb.parse_fiche(ffvb.pdf_lines(FICHE))
    assert fiche["gym"] == {"name": "GYMNASE TEST", "address": "1 RUE DU SPORT, 75000 PARIS"}
    assert fiche["teams"] == [{"club": "CLUB NOUS", "colors": "NOIR ET BLEU"}, {"club": "CLUB C", "colors": "ROUGE"}]
    assert "PERSONNE" not in str(fiche) and "PRESIDENT" not in str(fiche)


def test_collect_builds_a_small_document(monkeypatch):
    calls = []

    def fake_fetch(url, form=None):
        calls.append(url)
        if "fiche_match" in url:
            return FICHE
        if "saison=2025/2026" in url:
            raise ffvb.FfvbError("pas de saison précédente")
        return POOL.encode("cp1252")

    monkeypatch.setattr(ffvb, "fetch", fake_fetch)
    monkeypatch.setattr(ffvb.time, "sleep", lambda s: None)
    src = {"season": "2026/2027", "codent": "PTTEST", "poule": "ABC"}
    known = {"gyms": {"VIEILLE SALLE": "plus utilisée"}, "teams": {"EQUIPE Z": {"colors": "VERT"}}}
    doc = ffvb.collect(src, "NOUS", known, log=lambda msg: None)
    assert doc["team"] == "NOUS" and len(doc["matches"]) == 2 and doc["previous"] is None
    assert doc["gyms"] == {"GYMNASE TEST": "1 RUE DU SPORT, 75000 PARIS"}  # l'ancienne salle n'est plus gardée
    assert doc["teams"]["EQUIPE C"] == {"club": "CLUB C", "colors": "ROUGE"} and "EQUIPE Z" not in doc["teams"]
    assert doc["teams"]["NOUS"]["site"] == "https://club-nous.example"
    assert sum("fiche_match" in u for u in calls) == 1  # seule la fiche du prochain match de l'équipe
    # Fiche déjà connue : pas de nouvelle requête.
    calls.clear()
    ffvb.collect(src, "NOUS", doc, log=lambda msg: None)
    assert not any("fiche_match" in u for u in calls)


def test_league_is_stored_and_served(team):
    doc = {"source": {"season": "2026/2027", "codent": "PTTEST", "poule": "ABC"}, "title": "ABC - TEST", "team": "NOUS",
           "updatedAt": "2026-11-04T22:00:00Z", "adjust": {},
           "matches": [{"code": "ABCA001", "round": 1, "date": "2026-10-03", "time": "20:00", "home": "EQUIPE A",
                        "away": "NOUS", "sets": [[25, 20], [18, 25]]},
                       {"code": "ABCA003", "round": 2, "date": "2026-11-09", "time": "", "home": "NOUS",
                        "away": "EQUIPE C", "sets": [], "gym": "GYMNASE TEST"}],
           "teams": {"EQUIPE C": {"colors": "ROUGE", "telephone": "ignoré"}}, "gyms": {"GYMNASE TEST": "1 RUE DU SPORT"},
           "previous": None}
    assert team.put("/api/league", json=doc).status_code == 200
    league = team.get("/api/state").get_json()["league"]
    assert league["matches"][1]["gym"] == "GYMNASE TEST" and league["teams"] == {"EQUIPE C": {"colors": "ROUGE"}}
    # Une nouvelle actualisation remplace tout : rien ne s'accumule.
    assert team.put("/api/league", json=dict(doc, matches=doc["matches"][:1], gyms={})).status_code == 200
    league = team.get("/api/state").get_json()["league"]
    assert len(league["matches"]) == 1 and league["gyms"] == {}
    bad = dict(doc, matches=[dict(doc["matches"][0], sets=[[25, "x"]])])
    assert team.put("/api/league", json=bad).status_code == 400
    assert team.put("/api/league", json=dict(doc, source={"season": "2026"})).status_code == 400


def _scuf_league():
    return {"source": {"season": "2026/2027", "codent": "PTTEST", "poule": "ARM"}, "title": "ARM - TEST", "team": "ASVP",
            "updatedAt": "2026-11-24T06:15:00Z", "adjust": {}, "teams": {}, "previous": None,
            "gyms": {"COURCELLES": "211 RUE DE COURCELLES, 75017 PARIS"},
            "matches": [{"code": "ARMA038", "round": 8, "date": "2026-12-13", "time": "15:30", "home": "SCUF",
                         "away": "ASVP", "sets": [], "gym": "COURCELLES"}]}


def test_league_fix_survives_refresh_until_ffvb_catches_up(team):
    doc = _scuf_league()
    assert team.put("/api/league", json=doc).status_code == 200
    fix = {"time": "14:30", "meet": "13:30", "gym": "Centre sportif Léon Biancotto",
           "address": "8 av. de la Porte de Clichy, 75017 Paris", "note": "Changement de lieu et d'horaire"}
    r = team.put("/api/league/fixes/ARMA038", json=fix)
    assert r.status_code == 200
    m = r.get_json()["matches"][0]
    assert (m["time"], m["gym"], m["date"]) == ("14:30", "Centre sportif Léon Biancotto", "2026-12-13")
    assert m["ffvb"] == {"time": "15:30", "gym": "COURCELLES"} and m["fix"]["meet"] == "13:30"
    assert r.get_json()["gyms"]["Centre sportif Léon Biancotto"].startswith("8 av.")
    # L'actualisation du matin (site pas encore à jour) ne touche pas à la correction.
    assert team.put("/api/league", json=doc).get_json()["confirmed"] == []
    assert team.get("/api/state").get_json()["league"]["matches"][0]["time"] == "14:30"
    # Le site affiche enfin le nouvel horaire et la salle : la correction est retirée, le rendez-vous reste.
    doc["matches"][0].update(time="14:30", gym="BIANCOTTO")
    doc["gyms"] = {"BIANCOTTO": "8 AV. DE LA PRTE DE CLICHY, 75017 PARIS"}
    assert team.put("/api/league", json=doc).get_json()["confirmed"] == ["ARMA038"]
    m = team.get("/api/state").get_json()["league"]["matches"][0]
    assert m["gym"] == "BIANCOTTO" and "ffvb" not in m and m["fix"]["meet"] == "13:30"
    # Tout vider efface la correction.
    m = team.put("/api/league/fixes/ARMA038", json={}).get_json()["matches"][0]
    assert "fix" not in m


def test_league_fix_is_checked(team):
    team.put("/api/league", json=_scuf_league())
    assert team.put("/api/league/fixes/ARMA999", json={"time": "14:30"}).status_code == 400
    assert team.put("/api/league/fixes/ARMA038", json={"time": "25:00"}).status_code == 400
    assert team.put("/api/league/fixes/ARMA038", json={"date": "13/12/2026"}).status_code == 400
    assert team.put("/api/league/fixes/ARMA038", json={"address": "sans salle"}).status_code == 400
    assert team.put("/f4/api/league/fixes/ARMA038", json={"time": "14:30"}).status_code == 404


def _fake_fdme() -> bytes:
    """Feuille de match fictive, aux positions de celles du site (seuls les textes utiles)."""
    t = [(375, 527, "NOUS"), (450, 527, "EUX"),
         (130, 512.7, "NOUS"), (237, 512.7, "Début: 19:27 R"), (286, 512.7, "EUX"), (401, 512.7, "Fin: 20:02 S"),
         (465, 512.7, "EUX"), (571, 512.7, "Début: 20:02 R"), (620, 512.7, "NOUS"), (735, 512.7, "Fin: 20:33 S"),
         (429, 147, "T"), (440, 147, "R"), (451, 147, "G"), (463, 147, "P"), (519.6, 147, "P"), (530.6, 147, "G"), (542, 147, "R"), (553.8, 147, "T"),
         (429.2, 138.5, "1"), (440.5, 138.5, "2"), (451.9, 138.5, "1"), (461.6, 138.5, "25"), (480.2, 138.5, "1"), (500.5, 138.5, "35'"),
         (518.2, 138.5, "21"), (531.2, 138.5, "0"), (542.6, 138.5, "0"), (553.9, 138.5, "0"),
         (429.2, 130, "0"), (440.5, 130, "0"), (451.9, 130, "0"), (461.6, 130, "20"), (480.2, 130, "2"), (500.5, 130, "31'"),
         (518.2, 130, "25"), (531.2, 130, "1"), (542.6, 130, "0"), (553.9, 130, "1"),
         (488.7, 96, "Fin"), (440.2, 87.5, "19:27"), (485.6, 87.5, "20:33"), (533.4, 87.5, "1h6"),
         (282.7, 155.8, "Licence"),
         (578.3, 325.6, "NOUS"), (705.8, 325.6, "EUX"),
         (578.3, 314.6, "N°"), (589.6, 314.6, "Nom Prénom"), (679.5, 314.6, "Licence"),
         (705.9, 314.6, "N°"), (717.2, 314.6, "Nom Prénom"), (807.1, 314.6, "Licence"),
         (578.3, 306.1, "01"), (589.6, 306.1, "JOUEUR UN"), (679.1, 306.1, "1000001"),
         (578.3, 297.6, "05"), (589.6, 297.6, "JOUEUR CINQ"), (679.1, 297.6, "1000005"),
         (705.9, 306.1, "07"), (717.2, 306.1, "JOUEUR SEPT"), (806.6, 306.1, "2000007"),
         (692, 186, "LIBEROS"), (578.3, 175.7, "05"), (589.6, 175.7, "JOUEUR CINQ"), (679.1, 175.7, "1000005"),
         (705, 147.3, "EA"), (717, 147.3, "ENTRAINEUR EUX"), (806.6, 147.3, "3000001"),
         (578.3, 96.3, "Capitaine"), (705.8, 96.3, "Capitaine")]
    body = "\n".join(f"BT {x:.2f} {y:.2f} Td ({s}) Tj ET" for x, y, s in t).encode("cp1252")
    return b"%PDF-1.4\n4 0 obj\nstream\n" + zlib.compress(body) + b"\nendstream\nendobj\n"


def test_parse_fdme():
    d = ffvb.parse_fdme(_fake_fdme())
    assert (d["a"], d["b"], d["start"], d["end"], d["min"]) == ("NOUS", "EUX", "19:27", "20:33", 66)
    s1, s2 = d["sets"]
    assert (s1["serve"], s1["start"], s1["end"], s1["a"], s1["b"]) == ("b", "19:27", "20:02", {"pts": 25, "to": 1, "subs": 2}, {"pts": 21, "to": 0, "subs": 0})
    assert (s2["serve"], s2["a"]["pts"], s2["b"]["to"]) == ("a", 20, 1)
    a, b = d["rosters"]["a"], d["rosters"]["b"]
    assert a["players"] == [{"num": "01", "name": "JOUEUR UN", "lic": "1000001"},
                            {"num": "05", "name": "JOUEUR CINQ", "lic": "1000005", "libero": True}]
    assert b["players"] == [{"num": "07", "name": "JOUEUR SEPT", "lic": "2000007"}] and b["staff"][0]["role"] == "EA"
    assert ffvb.parse_fdme(b"<html>pas de feuille</html>") is None


def test_league_sheet_stored_and_served(team):
    team.put("/api/league", json=_scuf_league())
    sheet = ffvb.parse_fdme(_fake_fdme())
    assert team.put("/api/league/sheets/ARMA999", json=sheet).status_code == 400
    assert team.put("/api/league/sheets/ARMA038", json=sheet).status_code == 200
    assert team.get("/api/state").get_json()["league"]["sheets"] == ["ARMA038"]
    got = team.get("/api/league/sheets/ARMA038").get_json()
    assert got["rosters"]["a"]["players"][1]["libero"] is True and got["sets"][0]["serve"] == "b"
    bad = dict(sheet, rosters={"a": {"players": [{"num": "1x", "name": "X", "lic": ""}]}, "b": {}})
    assert team.put("/api/league/sheets/ARMA038", json=bad).status_code == 400
    # Le match quitte la poule (nouvelle saison) : sa feuille part avec.
    doc = _scuf_league()
    doc["matches"][0]["code"] = "ARMA039"
    team.put("/api/league", json=doc)
    assert team.get("/api/league/sheets/ARMA038").status_code == 404
