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


def test_api_level_is_exposed_for_stale_page_detection(client):
    assert client.get("/api/state").get_json()["app"]["api"] >= 5


def test_upcoming_match_time(team):
    match = {"opponent": "Club Exemple", "date": "2026-11-07", "time": "20:30", "venue": "ext"}
    assert team.put("/api/matches/m-avenir", json=match).status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-avenir"]["time"] == "20:30"
    # Une ancienne page n'envoie pas l'heure : elle est conservée.
    assert team.put("/api/matches/m-avenir", json={"opponent": "Club Exemple", "date": "2026-11-07"}).status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-avenir"]["time"] == "20:30"
    assert team.put("/api/matches/m-avenir", json=dict(match, time="")).status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-avenir"]["time"] == ""
    r = team.put("/api/matches/m-avenir", json=dict(match, time="25:00"))
    assert r.status_code == 400 and "Heure" in r.get_json()["error"]


def test_installable_app_manifest_and_icons(client):
    page = client.get("/").data
    assert b'rel="manifest" href="manifest.webmanifest"' in page and b'rel="apple-touch-icon"' in page
    res = client.get("/manifest.webmanifest")
    assert res.status_code == 200 and res.mimetype == "application/manifest+json"
    manifest = res.get_json(force=True)
    assert manifest["display"] == "standalone" and manifest["short_name"]
    sizes = {i["sizes"] for i in manifest["icons"]}
    assert {"192x192", "512x512"} <= sizes and any(i.get("purpose") == "maskable" for i in manifest["icons"])
    for icon in manifest["icons"] + [i for s in manifest["shortcuts"] for i in s["icons"]]:
        img = client.get("/" + icon["src"])
        assert img.status_code == 200 and img.mimetype == "image/png", icon["src"]


LINEUP = {"label": "Set 1", "positions": {"1": "joueur-a", "2": "joueur-c"}, "libero": "joueur-b",
          "pairs": [["joueur-a", "joueur-c"]], "comment": "Compo de base"}
CONSIGNES = [{"text": "Servir long", "level": 1}, {"text": "Bloc sur le pointu", "level": 2}]


def test_coach_lineups_and_consignes(team):
    match = {"opponent": "Club Exemple", "date": "2026-12-05", "lineups": [LINEUP], "consignes": CONSIGNES}
    assert team.put("/api/matches/m-prepa", json=match).status_code == 200
    m = team.get("/api/state").get_json()["matches"]["m-prepa"]
    assert m["lineups"] == [LINEUP] and m["consignes"] == CONSIGNES
    # Une page plus ancienne n'envoie ni compos ni consignes : elles sont conservées.
    assert team.put("/api/matches/m-prepa", json={"opponent": "Club Exemple", "date": "2026-12-05"}).status_code == 200
    m = team.get("/api/state").get_json()["matches"]["m-prepa"]
    assert m["lineups"] == [LINEUP] and m["consignes"] == CONSIGNES
    assert team.put("/api/matches/m-prepa", json=dict(match, lineups=[], consignes=[])).status_code == 200
    m = team.get("/api/state").get_json()["matches"]["m-prepa"]
    assert m["lineups"] == [] and m["consignes"] == []
    bad = [dict(LINEUP, positions={"1": "joueur-a", "2": "joueur-a"}),      # un joueur à deux positions
           dict(LINEUP, positions={"7": "joueur-a"}),                        # position inconnue
           dict(LINEUP, libero="joueur-a"),                                  # le libéro est aussi en position 1
           dict(LINEUP, pairs=[["joueur-a", "joueur-a"]]),                   # binôme avec soi-même
           dict(LINEUP, comment="x" * 1001)]
    for lineup in bad:
        assert team.put("/api/matches/m-prepa", json=dict(match, lineups=[lineup])).status_code == 400
    assert team.put("/api/matches/m-prepa", json=dict(match, lineups=[LINEUP] * 5)).status_code == 400
    for consignes in ([{"text": "x", "level": 4}], [{"text": "x" * 1001, "level": 1}], [{"text": "x"}], [{"text": "x", "level": True}],
                      [{"text": "x", "level": 1, "roles": ["gardien"]}], [{"text": "x", "level": 1, "roles": "passeur"}]):
        assert team.put("/api/matches/m-prepa", json=dict(match, consignes=consignes)).status_code == 400


def test_old_free_text_note_becomes_consignes(team, app):
    from stator.models import Match, db
    with app.app_context():
        db.session.get(Match, "m-exemple").coach_note = "- Servir long\n- Bloc fermé"
        db.session.commit()
    assert team.get("/api/state").get_json()["matches"]["m-exemple"]["consignes"] == [
        {"text": "Servir long", "level": 2}, {"text": "Bloc fermé", "level": 2}]


def test_lineup_templates(team):
    roster = [{"id": "joueur-a", "name": "Joueur A", "active": True, "poste": "central"},
              {"id": "joueur-b", "name": "Joueur B", "active": True, "poste": "libero"},
              {"id": "joueur-c", "name": "Joueur C", "active": True}]
    tpl = {"id": "t-base", "name": "Compo de base", "positions": {"3": "joueur-a"}, "libero": "joueur-b",
           "pairs": [["joueur-a", "joueur-c"]], "comment": ""}
    assert team.put("/api/config", json={"roster": roster, "templates": [tpl]}).status_code == 200
    assert team.get("/api/state").get_json()["config"]["templates"] == [dict(tpl, label="")]
    assert team.put("/api/config", json={"roster": roster}).status_code == 200            # sans le champ : conservées
    assert len(team.get("/api/state").get_json()["config"]["templates"]) == 1
    for templates in ([dict(tpl, name="")], [dict(tpl, pairs=[["joueur-a", "joueur-z"]])], [tpl] * 13):
        assert team.put("/api/config", json={"roster": roster, "templates": templates}).status_code == 400
    assert team.put("/api/config", json={"roster": roster, "templates": []}).status_code == 200
    assert team.get("/api/state").get_json()["config"]["templates"] == []


def test_club_logos_are_small_webp_files(client):
    from pathlib import Path
    logos = sorted(Path(__file__).resolve().parent.parent.joinpath("web", "img", "clubs").glob("*.webp"))
    assert logos, "aucun logo de club"
    for logo in logos:
        assert logo.stat().st_size < 8 * 1024, logo.name           # petits fichiers : peu de stockage sur le serveur
        res = client.get("/img/clubs/" + logo.name)
        assert res.status_code == 200 and res.mimetype == "image/webp", logo.name


def test_passes_to_back_row_positions(team):
    """Les passes se notent aussi vers les postes 6 et 1 (attaque de l'arrière)."""
    ref = team.get("/referentiel.json").get_json()
    assert [p["n"] for p in ref["court_positions"]] == [4, 3, 2, 6, 1]
    fiche = dict(FICHE, sets={"1": {"passe": {"reussie_p6": 2, "reussie_p1": 1, "moyenne_p1": 1, "reussie_p3": 4}}})
    assert team.put("/api/stats/m-exemple__joueur-a", json=fiche).status_code == 200
    assert team.get("/api/state").get_json()["stats"]["m-exemple__joueur-a"]["sets"] == fiche["sets"]


def test_consignes_without_priority_and_long_text(team):
    """Une consigne peut n'avoir aucune priorité (0) et tenir sur plusieurs lignes, jusqu'à 1000 caractères."""
    long_rule = ("Tout joueur qui commet 3 fautes directes est remplacé. " * 8).strip() + "\nPour le reste, les schémas parlent d'eux-mêmes."
    consignes = [{"text": long_rule, "level": 0}, {"text": "Servir long", "level": 1}]
    assert len(long_rule) > 300
    r = team.put("/api/matches/m-prepa", json={"opponent": "Club Exemple", "date": "2026-12-05", "consignes": consignes})
    assert r.status_code == 200 and r.get_json()["consignes"] == consignes


def test_consignes_for_some_roles(team):
    """Une consigne peut viser des postes (pour le filtre « Pour moi ») ; sans poste, elle vaut pour tous."""
    consignes = [{"text": "Bloc ligne sur leur 4", "level": 1, "roles": ["libero", "central"]}, {"text": "Enjoy", "level": 0, "roles": []}]
    r = team.put("/api/matches/m-prepa", json={"opponent": "Club Exemple", "date": "2026-12-05", "consignes": consignes})
    assert r.status_code == 200
    # Rangés dans l'ordre du référentiel ; une liste vide n'est pas enregistrée.
    assert r.get_json()["consignes"] == [{"text": "Bloc ligne sur leur 4", "level": 1, "roles": ["central", "libero"]},
                                         {"text": "Enjoy", "level": 0}]
