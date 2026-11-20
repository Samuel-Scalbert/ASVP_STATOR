"""Deux équipes (ASVP 6x6 à la racine, équipe féminine 4x4 sous /f4/) et le profil coach."""
import json

from werkzeug.security import generate_password_hash

COMPO_4 = {"label": "Set 1", "positions": {"1": "fille-a", "2": "fille-b", "3": "fille-c", "4": "fille-d"}}


def make_coach(app, password="mot-de-passe-coach"):
    with open(app.config["COACH_PROFILE"], "w", encoding="utf-8") as f:
        json.dump({"name": "Coach Test", "password": generate_password_hash(password), "teams": ["asvp", "f4"]}, f)


def girls(client):
    client.put("/f4/api/config", json={"team": "Équipe féminine 4x4", "roster": [
        {"id": f"fille-{c}", "name": f"Fille {c.upper()}", "poste": p}
        for c, p in zip("abcde", ["passeur", "r4", "central", "pointu", "r4"])]})


def test_each_team_has_its_own_page_and_database(team):
    girls(team)
    assert team.put("/f4/api/matches/m-f4", json={"opponent": "Adversaire 4x4", "date": "2026-11-15"}).status_code == 200
    asvp, f4 = team.get("/api/state").get_json(), team.get("/f4/api/state").get_json()
    assert set(asvp["matches"]) == {"m-exemple"} and set(f4["matches"]) == {"m-f4"}
    assert [p["id"] for p in asvp["config"]["roster"]] == ["joueur-a", "joueur-b"]
    assert len(f4["config"]["roster"]) == 5 and f4["league"] is None
    page = team.get("/f4/").get_data(as_text=True)
    assert '"key": "f4"' in page and '"format": 4' in page and "<title>Stator 4x4</title>" in page
    assert '"key": "asvp"' in team.get("/").get_data(as_text=True)
    assert team.get("/f4/js/core.js").status_code == 200
    assert 'href="css/team-f4.css?v=' in page and team.get("/f4/css/team-f4.css").status_code == 200
    assert "team-f4.css" not in team.get("/").get_data(as_text=True)  # l'ASVP garde son thème
    assert team.get("/f4/manifest.webmanifest").get_json()["name"] == "Stator 4x4"


def test_4x4_roles_and_lineups(team):
    roles = [r["key"] for r in team.get("/f4/referentiel.json").get_json()["roles"]]
    assert "libero" not in roles and roles[0] == "passeur"
    assert "libero" in [r["key"] for r in team.get("/referentiel.json").get_json()["roles"]]
    assert [p["n"] for p in team.get("/f4/referentiel.json").get_json()["court_positions"]] == [4, 3, 2, 1]  # pas de 6
    assert team.put("/f4/api/config", json={"roster": [{"id": "x", "name": "X", "poste": "libero"}]}).status_code == 400
    girls(team)
    team.put("/f4/api/matches/m-f4", json={"opponent": "Adversaire 4x4"})
    ok = team.put("/f4/api/matches/m-f4", json={"opponent": "Adversaire 4x4", "lineups": [COMPO_4]})
    assert ok.status_code == 200 and ok.get_json()["lineups"][0]["positions"]["4"] == "fille-d"
    five = dict(COMPO_4, positions=dict(COMPO_4["positions"], **{"5": "fille-e"}))
    assert team.put("/f4/api/matches/m-f4", json={"opponent": "Adversaire 4x4", "lineups": [five]}).status_code == 400
    lib = dict(COMPO_4, libero="fille-e")
    assert team.put("/f4/api/matches/m-f4", json={"opponent": "Adversaire 4x4", "lineups": [lib]}).status_code == 400
    # L'ASVP garde ses six places et son libéro.
    six = {"positions": {str(i): f"j{i}" for i in range(1, 7)}, "libero": "j7"}
    assert team.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "lineups": [six]}).status_code == 200


def test_no_league_for_the_4x4_team(client):
    doc = {"source": {"season": "2026/2027", "codent": "ABC", "poule": "X1"}, "team": "ASVP", "matches": []}
    assert client.put("/f4/api/league", json=doc).status_code == 404
    assert client.put("/api/league", json=doc).status_code == 200


def test_coach_login_and_team_switcher(app, client):
    assert client.get("/api/state").get_json()["coach"] == {"available": False, "coach": None}
    make_coach(app)
    assert client.get("/f4/api/state").get_json()["coach"] == {"available": True, "coach": None}
    assert client.post("/api/coach/login", json={"password": "faux"}).status_code == 403
    r = client.post("/api/coach/login", json={"password": "mot-de-passe-coach"})
    assert r.status_code == 200
    teams = r.get_json()["coach"]["teams"]
    assert [(t["key"], t["url"], t["current"]) for t in teams] == [("asvp", "/", True), ("f4", "/f4/", False)]
    # La même connexion vaut pour l'autre équipe (cookie commun) : le sélecteur y marque l'équipe affichée.
    f4 = client.get("/f4/api/state").get_json()["coach"]
    assert f4["coach"]["name"] == "Coach Test" and [t["current"] for t in f4["coach"]["teams"]] == [False, True]
    client.post("/f4/api/coach/logout")
    assert client.get("/api/state").get_json()["coach"]["coach"] is None


def test_changing_the_password_logs_the_coach_out(app, client):
    make_coach(app)
    client.post("/api/coach/login", json={"password": "mot-de-passe-coach"})
    make_coach(app, "nouveau-mot-de-passe")
    assert client.get("/api/state").get_json()["coach"]["coach"] is None


def test_login_is_locked_after_repeated_failures(app, client):
    make_coach(app)
    for _ in range(5):
        client.post("/api/coach/login", json={"password": "faux"}, environ_base={"REMOTE_ADDR": "10.0.0.9"})
    r = client.post("/api/coach/login", json={"password": "mot-de-passe-coach"}, environ_base={"REMOTE_ADDR": "10.0.0.9"})
    assert r.status_code == 403 and "essais" in r.get_json()["error"]
