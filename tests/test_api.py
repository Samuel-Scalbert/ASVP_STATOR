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
    assert b"js/app.js?v=" in page.data and page.headers["Cache-Control"] == "no-cache"  # pas de vieux scripts en cache
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


def test_version_is_exposed(client):
    health = client.get("/api/health").get_json()
    assert health["ok"] is True and health["version"]
    assert client.get("/api/state").get_json()["app"]["version"] == health["version"]


def test_match_squad(team):
    r = team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "squad": ["joueur-a", "joueur-b", "joueur-a"]})
    assert r.status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-exemple"]["squad"] == ["joueur-a", "joueur-b"]
    assert team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "squad": "joueur-a"}).status_code == 400


def test_match_without_video(team):
    r = team.put("/api/matches/m-sans-video", json={"opponent": "Club Exemple", "noData": True, "result": {"a": 1, "o": 3}})
    assert r.status_code == 200
    m = team.get("/api/state").get_json()["matches"]["m-sans-video"]
    assert m["noData"] is True and m["result"] == {"a": 1, "o": 3}
    assert team.put("/api/matches/m-sans-score", json={"opponent": "Club Exemple", "noData": True}).status_code == 400
    assert team.get("/api/state").get_json()["matches"]["m-exemple"]["noData"] is False


def test_video_on_discord_and_closed_match(team):
    r = team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "videoKind": "discord",
                                                  "videoNote": "match-retour.mp4", "video": "https://ignore.me", "closed": True})
    assert r.status_code == 200
    m = team.get("/api/state").get_json()["matches"]["m-exemple"]
    assert (m["videoKind"], m["videoNote"], m["video"], m["closed"]) == ("discord", "match-retour.mp4", "", True)
    assert team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "videoKind": "cassette"}).status_code == 400
    assert team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "videoKind": "lien", "video": ""}).status_code == 400


def test_excel_version_pending_on_a_sheet(team):
    excel = {"status": "pending", "sets": {"1": {"attaque": {"decisive_p3": 4}}}, "bilan": {"pp": "Vu dans l'Excel"},
             "file": "ASVP - Club Exemple.xlsx", "at": "2026-10-22"}
    r = team.put("/api/stats/m-exemple__joueur-a", json=dict(FICHE, source="app", excel=excel))
    assert r.status_code == 200
    doc = team.get("/api/state").get_json()["stats"]["m-exemple__joueur-a"]
    assert doc["source"] == "app" and doc["excel"]["status"] == "pending"
    assert doc["excel"]["sets"] == excel["sets"] and doc["excel"]["bilan"]["pp"] == "Vu dans l'Excel"
    assert doc["sets"] == FICHE["sets"]  # la saisie de l'app n'est pas touchée
    bad = dict(excel, sets={"1": {"attaque": {"inconnue": 1}}})
    assert team.put("/api/stats/m-exemple__joueur-a", json=dict(FICHE, excel=bad)).status_code == 400
    assert team.put("/api/stats/m-exemple__joueur-a", json=dict(FICHE, source="papier")).status_code == 400
    team.put("/api/stats/m-exemple__joueur-a", json=dict(FICHE, excel=None))
    assert team.get("/api/state").get_json()["stats"]["m-exemple__joueur-a"]["excel"] is None
