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
