"""ASVP Stator : application Flask (API REST + base SQL) qui sert l'interface du dossier web/.

Une app Flask par équipe (voir teams.py) : l'ASVP à la racine du site, les autres équipes sous leur préfixe
(ex. /f4/), chacune avec sa base. create_app() renvoie l'app de l'ASVP, qui sert aussi les autres équipes.
"""
from __future__ import annotations

import html
import json
import os
import re
import subprocess
from pathlib import Path

from datetime import timedelta

from flask import Flask, Response, abort, jsonify, send_from_directory
from sqlalchemy import event, inspect, text
from sqlalchemy.engine import Engine

from werkzeug.middleware.dispatcher import DispatcherMiddleware

from . import coach
from .models import db
from .teams import DEFAULT_TEAM, TEAMS, public

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT_DIR / "web"
# Niveau de l'API : à augmenter (ici et dans web/js/store.js) quand la page envoie ou attend de nouvelles
# données. Une page plus récente que le serveur se met alors en lecture seule au lieu de perdre des données.
API_LEVEL = 11


def version_info() -> dict:
    """Version affichée dans l'app : numéro du fichier VERSION + dernier commit git (s'il est disponible)."""
    info = {"version": "", "commit": "", "date": "", "api": API_LEVEL}
    try:
        info["version"] = (ROOT_DIR / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        pass
    try:
        out = subprocess.run(["git", "log", "-1", "--format=%h %cs"], cwd=ROOT_DIR, capture_output=True,
                             text=True, timeout=5, check=True).stdout.split()
        if len(out) == 2:
            info["commit"], info["date"] = out
    except (OSError, subprocess.SubprocessError):
        pass  # pas de git sur cette machine : on affiche seulement le numéro de version
    return info

# L'interface (web/index.html) est écrite sans <html>/<head> pour pouvoir aussi être
# publiée en artefact Claude ; Flask l'enveloppe dans ce squelette.
SKELETON = (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<link rel="icon" href="{logo}">'
    # App installée sur un téléphone : nom, icône (Android via le manifeste, iPhone via apple-touch-icon), couleur.
    '<link rel="manifest" href="manifest.webmanifest">'
    '{touch_icon}'
    '<meta name="apple-mobile-web-app-title" content="{app}">'
    '<meta name="theme-color" content="{theme_color}">'
    "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
    # L'équipe servie, lue par la page avant ses scripts (web/js/core.js, TEAM).
    "<script>window.STATOR_TEAM={team_json};</script>"
    "</head><body>{page}{team_style}</body></html>"
)


def _team_style(team: dict, tag: str) -> str:
    """Thème propre à l'équipe (teams.py, « css ») : chargé après les styles de la page pour les remplacer."""
    css = team.get("css")
    return f'<link rel="stylesheet" href="{css}?v={tag}">' if css else ""


def _team_page(page: str, team: dict) -> str:
    """index.html adapté à l'équipe : titre, description."""
    if team["key"] == DEFAULT_TEAM:
        return page
    page = page.replace("<title>ASVP Stator</title>", f"<title>{html.escape(team['app'])}</title>", 1)
    page = re.sub(r'(<meta name="description" content=")[^"]*"',
                  lambda m: m.group(1) + html.escape(f"Les stats de match de l’équipe {team['name']}, saisies set par set.") + '"',
                  page, count=1)
    return page.replace("ASVP&nbsp;<b", "Stator&nbsp;<b", 1)  # bandeau affiché pendant le chargement


@event.listens_for(Engine, "connect")
def _sqlite_foreign_keys(dbapi_conn, _record):
    if type(dbapi_conn).__module__.startswith("sqlite3"):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def _upgrade_schema() -> None:
    """Met à niveau une base créée par une version précédente de l'app."""
    columns = {c["name"] for c in inspect(db.engine).get_columns("matches")}
    with db.engine.begin() as conn:
        if "video_url" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN video_url VARCHAR(300) DEFAULT ''"))
        if "squad" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN squad TEXT DEFAULT ''"))
        if "no_data" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN no_data BOOLEAN DEFAULT 0"))
        if "video_kind" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN video_kind VARCHAR(10) DEFAULT ''"))
            conn.execute(text("UPDATE matches SET video_kind = 'lien' WHERE video_url <> ''"))
        if "video_note" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN video_note VARCHAR(200) DEFAULT ''"))
        if "closed" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN closed BOOLEAN DEFAULT 0"))
        if "match_time" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN match_time VARCHAR(5) DEFAULT ''"))
        if "lineup_json" not in columns:
            conn.execute(text("ALTER TABLE matches ADD COLUMN lineup_json TEXT DEFAULT ''"))
            conn.execute(text("ALTER TABLE matches ADD COLUMN coach_note TEXT DEFAULT ''"))
        sheet_columns = {c["name"] for c in inspect(conn).get_columns("stat_sheets")}
        if "source" not in sheet_columns:
            conn.execute(text("ALTER TABLE stat_sheets ADD COLUMN source VARCHAR(10) DEFAULT 'app'"))
        if "excel_json" not in sheet_columns:
            conn.execute(text("ALTER TABLE stat_sheets ADD COLUMN excel_json TEXT DEFAULT ''"))
        for view in ("v_player_match", "v_player_skill", "v_stats_detail"):  # vues d'analyse retirées
            conn.execute(text(f"DROP VIEW IF EXISTS {view}"))


def create_app(test_config: dict | None = None, team: str = DEFAULT_TEAM) -> Flask:
    """L'app d'une équipe. Celle de l'ASVP (par défaut) sert aussi les autres équipes sous leur préfixe.

    test_config["TEAM_DATABASES"] : adresse de la base de chaque autre équipe (tests), ex. {"f4": "sqlite:///…"}.
    """
    profile = TEAMS[team]
    test_config = dict(test_config or {})
    team_dbs = test_config.pop("TEAM_DATABASES", {})
    app = Flask(__name__, instance_relative_config=True, static_folder=None)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    default_db = "sqlite:///" + str(Path(app.instance_path) / profile["db"])
    app.config.from_mapping(
        # STATOR_DATABASE_URL ne concerne que la base de l'ASVP ; chaque autre équipe a son fichier dans instance/.
        SQLALCHEMY_DATABASE_URI=(os.environ.get("STATOR_DATABASE_URL") if team == DEFAULT_TEAM else None) or default_db,
        REFERENTIEL_PATH=str(WEB_DIR / "referentiel.json"),
        STATOR_TEAM=profile,
        COACH_PROFILE=str(Path(app.instance_path) / "coach.json"),
        # Connexion du coach : cookie signé, commun à toutes les équipes (même clé, chemin « / »).
        SECRET_KEY=os.environ.get("STATOR_SECRET_KEY") or coach.secret_key(Path(app.instance_path)),
        SESSION_COOKIE_NAME="stator_session",
        SESSION_COOKIE_PATH="/",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("STATOR_HTTPS") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=60),
    )
    if team in team_dbs:
        app.config["SQLALCHEMY_DATABASE_URI"] = team_dbs[team]
    app.config.update(test_config)
    app.json.ensure_ascii = False
    app.config["STATOR_VERSION"] = version_info()
    db.init_app(app)

    from . import api, referentiel

    app.register_blueprint(api.bp)
    with app.app_context():
        db.create_all()
        _upgrade_schema()
        referentiel.sync_fields()

    @app.get("/")
    def index():
        page = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        # Les scripts changent d'adresse à chaque version : un navigateur ne peut pas garder l'ancienne en cache.
        v = app.config["STATOR_VERSION"]
        tag = v.get("commit") or v.get("version") or "dev"
        page = re.sub(r'(src="js/[^"?]+\.js)"', rf'\1?v={tag}"', page)
        team_json = json.dumps(public(profile), ensure_ascii=False).replace("<", "\\u003c")
        touch = '<link rel="apple-touch-icon" href="img/apple-touch-icon.png">' if profile["icons"] else ""
        out = (SKELETON.replace("{logo}", profile["logo"]).replace("{touch_icon}", touch)
               .replace("{app}", html.escape(profile["app"])).replace("{team_json}", team_json)
               .replace("{team_style}", _team_style(profile, tag)).replace("{theme_color}", profile["theme_color"]).replace("{page}", _team_page(page, profile)))
        resp = Response(out, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/<path:path>")
    def web_file(path: str):
        if path == "manifest.webmanifest":
            if team == DEFAULT_TEAM:
                return send_from_directory(WEB_DIR, path, max_age=0, mimetype="application/manifest+json")
            return Response(json.dumps(_manifest(profile), ensure_ascii=False), mimetype="application/manifest+json")
        if path == "referentiel.json":
            resp = jsonify(referentiel.load())  # avec les postes de l'équipe
            resp.headers["Cache-Control"] = "no-cache"
            return resp
        if path.startswith("api/") or not path.startswith(("js/", "img/", "css/")):
            abort(404)
        return send_from_directory(WEB_DIR, path, max_age=0)

    if team == DEFAULT_TEAM:
        # Les autres équipes, chacune sous son préfixe, avec sa base (voir teams.py).
        # Jamais la base de l'ASVP pour une autre équipe : chacune garde la sienne (TEAM_DATABASES en test).
        shared = {k: v for k, v in test_config.items() if k != "SQLALCHEMY_DATABASE_URI"}
        others = {key: create_app(dict(shared, TEAM_DATABASES=team_dbs), key)
                  for key in TEAMS if key != DEFAULT_TEAM}
        app.extensions["stator_teams"] = others
        app.wsgi_app = DispatcherMiddleware(app.wsgi_app, {TEAMS[k]["prefix"]: a.wsgi_app for k, a in others.items()})
    return app


def _manifest(team: dict) -> dict:
    """Manifeste d'app installable propre à l'équipe (nom, icône)."""
    return {
        "id": "./", "name": team["app"], "short_name": team["app"],
        "description": f"Les stats de match de l’équipe {team['name']}.",
        "lang": "fr", "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": team["theme_color"], "theme_color": team["theme_color"],
        "icons": [{"src": team["logo"], "sizes": "any", "type": "image/svg+xml", "purpose": "any"}],
    }
