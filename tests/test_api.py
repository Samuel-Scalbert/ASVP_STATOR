from stator.models import StatCount, db

FICHE = {
    "id": "m-exemple__joueur-a", "matchId": "m-exemple", "playerId": "joueur-a",
    "sets": {"1": {"service": {"incisif": 1, "cadeau": 1, "erreur": 1}, "attaque": {"decisive_p3": 3, "erreur": 2}},
             "2": {"bloc": {"present": 5}}},
    "bilan": {"pp": "Présent au bloc", "pm": "Service", "cp": "", "cm": ""},
}


def test_page_and_static_files(client):
    page = client.get("/")
    assert page.status_code == 200 and b"<!doctype html>" in page.data and b"ASVP Stator" in page.data
    assert client.get("/js/core.js").status_code == 200
    assert client.get("/referentiel.json").status_code == 200
    assert client.get("/stator/models.py").status_code == 404


def test_state_round_trip(team):
    assert team.put("/api/stats/m-exemple__joueur-a", json=FICHE).status_code == 200
    state = team.get("/api/state").get_json()
    assert state["config"]["roster"][0] == {"id": "joueur-a", "name": "Joueur A", "active": True, "poste": "central"}
    m = state["matches"]["m-exemple"]
    assert m["date"] == "2026-10-18" and m["sets"][0] == {"a": 25, "o": 18} and m["result"] is None
    doc = state["stats"]["m-exemple__joueur-a"]
    assert doc["sets"] == FICHE["sets"] and doc["bilan"]["pp"] == "Présent au bloc"


def test_rewriting_a_sheet_replaces_counts(team, app):
    team.put("/api/stats/m-exemple__joueur-a", json=FICHE)
    lighter = dict(FICHE, sets={"1": {"service": {"incisif": 2}}})
    assert team.put("/api/stats/m-exemple__joueur-a", json=lighter).status_code == 200
    assert team.get("/api/state").get_json()["stats"]["m-exemple__joueur-a"]["sets"] == {"1": {"service": {"incisif": 2}}}
    with app.app_context():
        assert db.session.query(StatCount).count() == 1


def test_rewriting_set_scores(team):
    r = team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "sets": [{"a": 25, "o": 23}], "result": None})
    assert r.status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-exemple"]["sets"] == [{"a": 25, "o": 23}]


def test_deleting_a_match_deletes_its_sheets(team, app):
    team.put("/api/stats/m-exemple__joueur-a", json=FICHE)
    assert team.delete("/api/matches/m-exemple").status_code == 204
    state = team.get("/api/state").get_json()
    assert state["matches"] == {} and state["stats"] == {}
    with app.app_context():
        assert db.session.query(StatCount).count() == 0


def test_invalid_data_is_refused_with_a_message(team):
    bad = dict(FICHE, sets={"1": {"service": {"inconnu": 1}}})
    r = team.put("/api/stats/m-exemple__joueur-a", json=bad)
    assert r.status_code == 400 and "inconnue" in r.get_json()["error"]
    assert team.put("/api/matches/m-x", json={"opponent": ""}).status_code == 400
    assert team.put("/api/stats/m-exemple__joueur-b", json=FICHE).status_code == 400  # id incohérent
    assert team.put("/api/config", json={"roster": [{"id": "a", "name": "A", "poste": "gardien"}]}).status_code == 400


def test_match_video_link(team):
    r = team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "video": "https://youtu.be/abc123XYZ_0"})
    assert r.status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-exemple"]["video"] == "https://youtu.be/abc123XYZ_0"
    assert team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "video": "javascript:alert(1)"}).status_code == 400
