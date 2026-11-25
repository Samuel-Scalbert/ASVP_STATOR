"""SportEasy : lecture des dispos (réponses fictives, même structure que l'API) et usage dans l'app."""
from datetime import date

from stator import ffvb, sporteasy

ROSTER = [{"id": "nico-n", "name": "Nico N", "active": True}, {"id": "nico-g", "name": "Nico G", "active": True},
          {"id": "kevin", "name": "Kévin", "active": True}, {"id": "lea", "name": "Léa", "active": True}]


def _league(team_name="NOUS"):
    return {"source": {"season": "2026/2027", "codent": "PTTEST", "poule": "ARM"}, "title": "ARM - TEST", "team": team_name,
            "updatedAt": "2026-11-24T06:15:00Z", "adjust": {}, "teams": {}, "previous": None, "gyms": {},
            "matches": [{"code": "ARMA029", "round": 5, "date": "2026-11-28", "time": "19:30", "home": "S.C. EUX",
                         "away": "NOUS", "sets": [], "gym": ""},
                        {"code": "ARMR074", "round": 12, "date": "2027-03-13", "time": "19:30", "home": "NOUS",
                         "away": "S.C. EUX", "sets": [], "gym": ""}]}


def _doc(available=("11", "12"), time="19:30"):
    return {"team": {"id": 99, "name": "NOUS MASC", "url": "https://nous-masc.sporteasy.net/"},
            "members": [{"id": "11", "name": "Nicolas Nyssen"}, {"id": "12", "name": "Kevin B"},
                        {"id": "13", "name": "Nicolas Gravoulet"}, {"id": "14", "name": "Matteo Bour"}],
            "events": [{"id": 1, "date": "2026-11-28", "time": time, "us": "away", "home": "SCEUX", "away": "NOUS MASC",
                        "cancelled": False, "groups": {"available": list(available), "rsvp": ["13"], "unavailable": ["14"], "not_selected": []}},
                       {"id": 2, "date": "2027-03-13", "time": "19:30", "us": "home", "home": "NOUS MASC", "away": "SCEUX",
                        "cancelled": False, "groups": None}]}


# ---------------------------------------------------------------- lecture de l'API (structure réelle)
def _api_event(eid, start, home_us, past=False, kind="championship_match"):
    us = {"is_current_team": True, "short_name": "NOUS MASC", "is_home": home_us}
    them = {"is_current_team": False, "short_name": "SCEUX", "is_home": not home_us}
    return {"id": eid, "category": {"type": kind}, "season": {"id": 7, "current": True}, "start_at": start,
            "is_cancelled": False, "is_past": past, "is_date_unknown": False,
            "opponent_left": us if home_us else them, "opponent_right": them if home_us else us}


def _att(group, pid, name):
    return {"group": {"slug_name": group}, "profile": {"id": pid, "full_name": name, "email": "x@example.org", "phone_number": "0600"}}


class FakeClient:
    def __init__(self):
        self.calls = []
        self.events = [_api_event(5, "2026-11-21T19:30:00+01:00", False, past=True),
                       _api_event(6, "2026-11-27T19:30:00+01:00", False, kind="training"),
                       _api_event(1, "2026-11-28T19:30:00+01:00", False),
                       _api_event(2, "2027-03-13T19:30:00+01:00", True)]

    def call(self, url, body=None):
        self.calls.append(url)
        if url == "/v2.1/me/teams/":
            return {"results": [{"id": 99, "name": "NOUS MASC", "web_url": "https://nous-masc.sporteasy.net/"}]}
        if url == "/v2.1/teams/99/events/":
            return {"results": self.events[:2], "_links": {"next": {"url": "page2"}}}
        if url == "/v2.1/teams/99/events/1/":
            return {"attendees": [{"results": [_att("available", 11, "Nicolas Nyssen"), _att("available", 12, "Kevin B")]},
                                  {"results": [_att("rsvp", 13, "Nicolas Gravoulet")]}, {"results": []},
                                  {"results": [_att("unavailable", 14, "Matteo Bour")]}]}
        if url == "/v2.1/teams/99/events/5/":
            return {"attendees": [{"results": [_att("played", 11, "Nicolas Nyssen"), _att("played", 15, "Thomas Pham")]}]}
        raise AssertionError(url)

    def pages(self, url):
        assert url == "/v2.1/teams/99/events/?season_id=7"
        return self.events


def test_collect_keeps_names_and_answers_only():
    client = FakeClient()
    doc = sporteasy.collect(client, today=date(2026, 11, 25))
    assert doc["team"] == {"id": 99, "name": "NOUS MASC", "url": "https://nous-masc.sporteasy.net/"}
    assert [m["name"] for m in doc["members"]] == ["Kevin B", "Matteo Bour", "Nicolas Gravoulet", "Nicolas Nyssen", "Thomas Pham"]
    assert all(set(m) == {"id", "name"} for m in doc["members"])  # ni e-mail ni téléphone
    away, home = doc["events"]  # l'entraînement et le match passé sont ignorés
    assert away == {"id": 1, "date": "2026-11-28", "time": "19:30", "us": "away", "home": "SCEUX", "away": "NOUS MASC",
                    "cancelled": False, "groups": {"available": ["11", "12"], "rsvp": ["13"], "unavailable": ["14"], "not_selected": []}}
    assert home["us"] == "home" and home["groups"] is None  # trop loin : réponses pas lues
    assert "/v2.1/teams/99/events/2/" not in client.calls


# ---------------------------------------------------------------- dans l'app
def _links(team):
    return {p["id"]: p.get("sporteasy") for p in team.get("/api/state").get_json()["config"]["roster"] if p["id"] in {r["id"] for r in ROSTER}}


def _setup(team):
    team.put("/api/config", json={"team": "NOUS", "roster": ROSTER})
    team.put("/api/league", json=_league())


def test_links_are_proposed_once_then_edited_in_roster(team):
    _setup(team)
    res = team.put("/api/sporteasy", json=_doc()).get_json()
    assert res["seeded"] == 3 and res["linked"] == 3
    roster = _links(team)
    assert roster == {"nico-n": "11", "nico-g": "13", "kevin": "12", "lea": None}
    # L'Effectif corrige : Léa est Matteo (pour le test), Nico G n'a plus de membre.
    fixed = [dict(p, sporteasy={"lea": "14", "nico-g": ""}.get(p["id"], roster[p["id"]])) for p in ROSTER]
    assert team.put("/api/config", json={"team": "NOUS", "roster": fixed}).status_code == 200
    # La lecture suivante ne repropose rien.
    assert team.put("/api/sporteasy", json=_doc()).get_json()["seeded"] == 0
    assert _links(team) == {"nico-n": "11", "nico-g": None, "kevin": "12", "lea": "14"}
    # Une page qui n'envoie pas le champ garde la correspondance ; deux joueurs pour un membre : refusé.
    team.put("/api/config", json={"team": "NOUS", "roster": ROSTER})
    assert _links(team)["lea"] == "14"
    dup = [dict(p, sporteasy="11") if p["id"] in ("nico-n", "kevin") else p for p in ROSTER]
    assert team.put("/api/config", json={"team": "NOUS", "roster": dup}).status_code == 400


def test_available_players_become_the_match_squad(team):
    _setup(team)
    team.put("/api/matches/m-arma029", json={"opponent": "S.C. EUX", "date": "2026-11-28", "squad": []})
    res = team.put("/api/sporteasy", json=_doc()).get_json()
    assert res["squads"] == ["ARMA029"]
    state = team.get("/api/state").get_json()
    assert state["matches"]["m-arma029"]["squad"] == ["nico-n", "kevin"]
    se = state["sporteasy"]
    assert se["applied"] == ["ARMA029"] and set(se["events"]) == {"ARMA029"}
    assert se["events"]["ARMA029"]["groups"]["unavailable"] == [{"name": "Matteo Bour"}]
    assert se["events"]["ARMA029"]["groups"]["rsvp"] == [{"player": "nico-g"}]
    # Le coach retire Kévin dans l'app : la lecture suivante, sans changement sur SportEasy, ne le remet pas.
    team.put("/api/matches/m-arma029", json={"opponent": "S.C. EUX", "date": "2026-11-28", "squad": ["nico-n"]})
    assert team.put("/api/sporteasy", json=_doc()).get_json()["squads"] == []
    assert team.get("/api/state").get_json()["matches"]["m-arma029"]["squad"] == ["nico-n"]
    # Nico G se déclare dispo : les dispos ont changé, on les reprend.
    assert team.put("/api/sporteasy", json=_doc(("11", "12", "13"))).get_json()["squads"] == ["ARMA029"]
    assert team.get("/api/state").get_json()["matches"]["m-arma029"]["squad"] == ["nico-n", "nico-g", "kevin"]


def test_match_created_later_takes_the_answers_and_the_sheet_does_not_override(team):
    _setup(team)
    team.put("/api/sporteasy", json=_doc())
    team.put("/api/matches/m-arma029", json={"opponent": "S.C. EUX", "date": "2026-11-28", "squad": []})
    assert team.get("/api/state").get_json()["matches"]["m-arma029"]["squad"] == ["nico-n", "kevin"]
    # Après le match, la feuille de match ne remplace pas les joueurs venus de SportEasy.
    doc = _league()
    doc["matches"][0]["sets"] = [[25, 20], [25, 20], [25, 20]]
    team.put("/api/league", json=doc)
    sheet = {"a": "S.C. EUX", "b": "NOUS", "start": "", "end": "", "min": 0, "sets": [],
             "rosters": {"a": {"players": [], "staff": []},
                         "b": {"players": [{"num": "1", "name": "NYSSEN NICOLAS", "lic": ""}, {"num": "2", "name": "X LEA", "lic": ""}], "staff": []}}}
    assert team.put("/api/league/sheets/ARMA029", json=sheet).status_code == 200
    assert team.get("/api/state").get_json()["matches"]["m-arma029"]["squad"] == ["nico-n", "kevin"]


def test_different_date_is_asked(team):
    _setup(team)
    team.put("/api/matches/m-arma029", json={"opponent": "S.C. EUX", "date": "2026-11-28", "time": "19:30", "squad": []})
    assert team.put("/api/sporteasy", json=_doc(time="20:00")).get_json()["dates"] == ["ARMA029"]
    m = team.get("/api/state").get_json()["league"]["matches"][0]
    assert m["se"] == {"date": "2026-11-28", "time": "20:00"}
    # Garder celle de l'app : la question disparaît, jusqu'à ce que SportEasy change encore.
    r = team.post("/api/sporteasy/dates/ARMA029", json={"keep": "app"})
    assert r.status_code == 200 and "se" not in r.get_json()["league"]["matches"][0]
    team.put("/api/sporteasy", json=_doc(time="20:30"))
    assert team.get("/api/state").get_json()["league"]["matches"][0]["se"]["time"] == "20:30"
    # Prendre celle de SportEasy : le match de la poule est corrigé, le match de l'app aussi.
    r = team.post("/api/sporteasy/dates/ARMA029", json={"keep": "sporteasy"}).get_json()
    f = r["league"]["matches"][0]
    assert f["time"] == "20:30" and f["ffvb"] == {"time": "19:30"} and "se" not in f
    assert r["match"]["time"] == "20:30"
    assert team.post("/api/sporteasy/dates/ARMA029", json={"keep": "app"}).status_code == 400  # plus de différence


def test_sporteasy_is_checked(team):
    _setup(team)
    bad = _doc()
    bad["events"][0]["date"] = "28/11/2026"
    assert team.put("/api/sporteasy", json=bad).status_code == 400
    bad = _doc()
    bad["team"]["url"] = "https://evil.example/"
    assert team.put("/api/sporteasy", json=bad).status_code == 400
    assert team.put("/f4/api/sporteasy", json=_doc()).status_code == 404


def test_ffvb_untouched():
    assert ffvb.points(3, 0) == 3
