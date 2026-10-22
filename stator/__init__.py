"""ASVP Stator : application Flask (API REST + base SQL) qui sert l'interface du dossier web/."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from flask import Flask, Response, abort, send_from_directory
from sqlalchemy import event, inspect, text
from sqlalchemy.engine import Engine

from .models import db

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT_DIR / "web"


def version_info() -> dict:
    """Version affichée dans l'app : numéro du fichier VERSION + dernier commit git (s'il est disponible)."""
    info = {"version": "", "commit": "", "date": ""}
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
    '<link rel="icon" href="img/logo-asvp.png">'
    "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>{page}</body></html>"
)


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
        sheet_columns = {c["name"] for c in inspect(conn).get_columns("stat_sheets")}
        if "source" not in sheet_columns:
            conn.execute(text("ALTER TABLE stat_sheets ADD COLUMN source VARCHAR(10) DEFAULT 'app'"))
        if "excel_json" not in sheet_columns:
            conn.execute(text("ALTER TABLE stat_sheets ADD COLUMN excel_json TEXT DEFAULT ''"))
        for view in ("v_player_match", "v_player_skill", "v_stats_detail"):  # vues d'analyse retirées
            conn.execute(text(f"DROP VIEW IF EXISTS {view}"))


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True, static_folder=None)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=os.environ.get("STATOR_DATABASE_URL")
        or "sqlite:///" + str(Path(app.instance_path) / "stator.db"),
        REFERENTIEL_PATH=str(WEB_DIR / "referentiel.json"),
    )
    if test_config:
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
        resp = Response(SKELETON.replace("{page}", page), mimetype="text/html")
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.get("/<path:path>")
    def web_file(path: str):
        if path.startswith("api/") or not (path.startswith(("js/", "img/")) or path == "referentiel.json"):
            abort(404)
        return send_from_directory(WEB_DIR, path, max_age=0)

    return app
