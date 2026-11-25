"""SportEasy : lit les réponses aux convocations des prochains matchs et les envoie à l'app.

Les joueurs disent sur SportEasy s'ils sont dispos pour un match. Ce module se connecte au compte SportEasy
rangé dans les secrets du dépôt GitHub (SPORTEASY_EMAIL, SPORTEASY_PASSWORD), lit les matchs de championnat
de la saison, puis envoie à l'app (PUT /api/sporteasy) :
- les membres de l'équipe : id et nom seulement (ni e-mail, ni téléphone, ni date de naissance) ;
- pour chaque match à venir : date, heure, adversaire, et pour ceux des 30 prochains jours, les membres
  dispos, sans réponse, absents et non convoqués.
Rien n'est lu après le match (ni présences ni compos). Il tourne sur GitHub Actions
(.github/workflows/sporteasy.yml), ou à la main depuis un PC, avec la bibliothèque standard seulement :

    python stator/sporteasy.py --essai        (affiche ce qui serait envoyé, sans rien envoyer)
    python stator/sporteasy.py --app https://samuelscalbert.eu.pythonanywhere.com

Sans les variables SPORTEASY_EMAIL et SPORTEASY_PASSWORD, il demande l'e-mail et le mot de passe
(depuis un terminal) ; sur GitHub, il s'arrête sans erreur tant que les secrets ne sont pas créés.
"""
from __future__ import annotations

import argparse
import getpass
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, timedelta

API = "https://api.sporteasy.net"
USER_AGENT = "ASVP-Stator (statistiques d'une equipe de volley)"
GROUPS = ("available", "rsvp", "unavailable", "not_selected")
DAYS_AHEAD = 30  # réponses lues pour les matchs des 30 prochains jours


class SportEasyError(Exception):
    """SportEasy n'a pas répondu ce qu'on attendait."""


class Client:
    def __init__(self) -> None:
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = ""

    def call(self, url: str, body: dict | None = None) -> dict:
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        data = None
        if body is not None:
            data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        req = urllib.request.Request(url if url.startswith("http") else API + url, data=data, headers=headers)
        try:
            with self.opener.open(req, timeout=30) as res:
                raw = res.read()
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SportEasyError("SportEasy refuse l'accès : e-mail ou mot de passe incorrect, ou compte sans accès à l'équipe.") from e
            raise SportEasyError(f"SportEasy a répondu {e.code} pour {url}") from e
        except (urllib.error.URLError, TimeoutError) as e:
            raise SportEasyError(f"SportEasy injoignable ({e})") from e
        return json.loads(raw.decode("utf-8")) if raw else {}

    def pages(self, url: str, limit: int = 10) -> list[dict]:
        """Toutes les pages d'une liste (lien « next »)."""
        out: list[dict] = []
        for _ in range(limit):
            res = self.call(url)
            out += res.get("results") or []
            url = (((res.get("_links") or {}).get("next")) or {}).get("url") or ""
            if not url:
                break
        return out

    def login(self, email: str, password: str) -> None:
        res = self.call("/v2.1/account/authenticate/", {"username": email, "password": password})
        if res.get("success") is False:
            raise SportEasyError("SportEasy refuse la connexion : e-mail ou mot de passe incorrect.")
        self.token = str(res.get("token") or res.get("access_token") or "")


def pick_team(teams: list[dict], wanted: str) -> dict:
    if wanted:
        hits = [t for t in teams if wanted.lower() in (t.get("name") or "").lower() or str(t.get("id")) == wanted]
    else:
        hits = teams if len(teams) == 1 else []
    if len(hits) != 1:
        names = ", ".join(t.get("name") or "?" for t in teams) or "aucune"
        raise SportEasyError(f"Équipe SportEasy à préciser avec --equipe (équipes du compte : {names}).")
    return hits[0]


def is_match(ev: dict) -> bool:
    return (ev.get("category") or {}).get("type") == "championship_match" and bool(ev.get("opponent_left")) and bool(ev.get("opponent_right"))


def event_doc(ev: dict) -> dict:
    """Un match SportEasy -> ce que l'app garde (sans les réponses)."""
    left, right = ev["opponent_left"], ev["opponent_right"]
    if right.get("is_home") and not left.get("is_home"):
        left, right = right, left
    home, away = left, right
    us = "home" if home.get("is_current_team") else "away"
    start = "" if ev.get("is_date_unknown") else str(ev.get("start_at") or "")
    return {"id": ev["id"], "date": start[:10], "time": start[11:16], "us": us,
            "home": home.get("short_name") or home.get("full_name") or "?", "away": away.get("short_name") or away.get("full_name") or "?",
            "cancelled": bool(ev.get("is_cancelled")), "groups": None}


def attendees(detail: dict) -> tuple[dict, dict]:
    """Détail d'un événement -> ({groupe: [ids]}, {id: nom}) pour les groupes d'avant le match."""
    groups: dict[str, list[str]] = {g: [] for g in GROUPS}
    names: dict[str, str] = {}
    for block in detail.get("attendees") or []:
        for a in block.get("results") or []:
            g = (a.get("group") or {}).get("slug_name")
            p = a.get("profile") or {}
            if not p.get("id"):
                continue
            pid = str(p["id"])
            names[pid] = p.get("full_name") or " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x) or "?"
            if g in groups:
                groups[g].append(pid)
    return groups, names


def collect(client: Client, wanted_team: str = "", today: date | None = None) -> dict:
    today = today or date.today()
    teams = client.call("/v2.1/me/teams/").get("results") or []
    team = pick_team(teams, wanted_team)
    base = f"/v2.1/teams/{team['id']}/events/"
    first = client.call(base).get("results") or []
    season = next((e["season"]["id"] for e in first if (e.get("season") or {}).get("current")), None)
    events = client.pages(f"{base}?season_id={season}") if season else first
    members: dict[str, str] = {}
    out = []
    horizon = (today + timedelta(days=DAYS_AHEAD)).isoformat()
    for ev in events:
        if not is_match(ev) or ev.get("is_past"):
            continue
        doc = event_doc(ev)
        if doc["date"] and doc["date"] <= horizon and not doc["cancelled"]:
            doc["groups"], names = attendees(client.call(f"{base}{ev['id']}/"))
            members.update(names)
        out.append(doc)
    # Tout l'effectif SportEasy, même sans match proche : le dernier événement passé liste tout le monde.
    past = [e for e in events if e.get("is_past")]
    if past:
        members.update(attendees(client.call(f"{base}{past[-1]['id']}/"))[1])
    return {"team": {"id": team["id"], "name": team.get("name") or "", "url": team.get("web_url") or ""},
            "members": [{"id": k, "name": v} for k, v in sorted(members.items(), key=lambda kv: kv[1])],
            "events": out}


def _put(app: str, doc: dict) -> dict:
    req = urllib.request.Request(app + "/api/sporteasy", data=json.dumps(doc, ensure_ascii=False).encode(), method="PUT",
                                 headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:300]
        raise SportEasyError(f"l'app a refusé les données SportEasy ({e.code}) : {detail}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise SportEasyError(f"app injoignable ({e})") from e


def summary(doc: dict) -> list[str]:
    names = {m["id"]: m["name"] for m in doc["members"]}
    lines = [f"SportEasy {doc['team']['name']} : {len(doc['members'])} membres, {len(doc['events'])} matchs à venir."]
    for ev in doc["events"]:
        head = f"  {ev['date'] or 'date ?'} {ev['time']} {ev['home']} – {ev['away']}{' (annulé)' if ev['cancelled'] else ''}"
        if ev["groups"] is not None:
            g = ev["groups"]
            head += (f" : {len(g['available'])} dispos, {len(g['rsvp'])} sans réponse, {len(g['unavailable'])} absents"
                     f", {len(g['not_selected'])} non convoqués")
            if g["available"]:
                head += "\n    dispos : " + ", ".join(names.get(i, "?") for i in g["available"])
        lines.append(head)
    return lines


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python stator/sporteasy.py", description="Envoie à l'app les dispos SportEasy des prochains matchs.")
    p.add_argument("--app", default=os.environ.get("STATOR_URL") or "http://127.0.0.1:5000",
                   help="adresse de l'app (par défaut : variable STATOR_URL, sinon http://127.0.0.1:5000)")
    p.add_argument("--equipe", default=os.environ.get("SPORTEASY_TEAM") or "", help="nom ou id de l'équipe SportEasy, si le compte en a plusieurs")
    p.add_argument("--essai", action="store_true", help="affiche ce qui serait envoyé, sans rien envoyer")
    args = p.parse_args(argv)
    email, password = os.environ.get("SPORTEASY_EMAIL", ""), os.environ.get("SPORTEASY_PASSWORD", "")
    if not (email and password):
        missing = "SportEasy : pas d'identifiants (secrets SPORTEASY_EMAIL et SPORTEASY_PASSWORD du dépôt) : rien à faire."
        if os.environ.get("GITHUB_ACTIONS") or not sys.stdin.isatty():
            print(missing)
            return 0
        try:
            email = email or input("E-mail SportEasy : ").strip()
            password = password or getpass.getpass("Mot de passe SportEasy (rien ne s'affiche) : ")
        except EOFError:
            print()
            print(missing)
            return 0
    try:
        client = Client()
        client.login(email, password)
        doc = collect(client, args.equipe)
        print("\n".join(summary(doc)))
        if args.essai:
            print("(essai) rien n'est envoyé.")
            return 0
        res = _put(args.app.rstrip("/"), doc)
        print(f"Envoyé à l'app {args.app} : {res.get('linked', 0)} joueurs reliés à SportEasy"
              + (f" (dont {res['seeded']} proposés d'après les noms, à vérifier dans l'Effectif)" if res.get("seeded") else "") + ".")
        for code in res.get("squads") or []:
            print(f"Match {code} : joueurs du match mis à jour d'après les dispos.")
        for code in res.get("dates") or []:
            print(f"Match {code} : SportEasy n'a pas la même date ou heure que l'app (la page demande laquelle garder).")
        return 0
    except SportEasyError as e:
        print(f"Erreur : {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
