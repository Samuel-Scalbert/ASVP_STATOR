"""API REST consommée par l'interface (web/js/store.js)."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from . import coach, referentiel, services
from .models import db

bp = Blueprint("api", __name__, url_prefix="/api")


def _body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise services.InvalidData("Corps JSON attendu.")
    return data


@bp.errorhandler(services.InvalidData)
def _invalid(exc: services.InvalidData):
    db.session.rollback()
    return jsonify(error=str(exc)), 400


@bp.get("/health")
def health():
    return jsonify(ok=True, **current_app.config["STATOR_VERSION"])


@bp.get("/state")
def get_state():
    data = services.state()
    data["app"] = current_app.config["STATOR_VERSION"]  # version qui tourne sur ce serveur
    data["coach"] = coach.state_doc()  # profil coach : sélecteur d'équipe s'il est connecté
    return jsonify(data)


@bp.post("/coach/login")
def coach_login():
    ok, message = coach.login(_body().get("password"))
    if not ok:
        return jsonify(error=message), 403
    return jsonify(coach.state_doc())


@bp.post("/coach/logout")
def coach_logout():
    coach.logout()
    return jsonify(coach.state_doc())


@bp.put("/config")
def put_config():
    roles = {r["key"] for r in referentiel.load().get("roles", [])}
    services.save_config(_body(), roles)
    return jsonify(services.config_doc())


@bp.put("/matches/<match_id>")
def put_match(match_id: str):
    return jsonify(services.match_doc(services.save_match(match_id, _body())))


@bp.delete("/matches/<match_id>")
def delete_match(match_id: str):
    services.delete_match(match_id)
    return "", 204


@bp.put("/stats/<sheet_id>")
def put_stats(sheet_id: str):
    sheet = services.save_sheet(sheet_id, _body())
    by_id = {v: k for k, v in referentiel.field_ids().items()}
    return jsonify(services.sheet_doc(sheet, by_id))


@bp.delete("/stats/<sheet_id>")
def delete_stats(sheet_id: str):
    services.delete_sheet(sheet_id)
    return "", 204


@bp.put("/league")
def put_league():
    """Données du championnat FFVolley, envoyées par stator/ffvb.py (voir ce module)."""
    if not current_app.config["STATOR_TEAM"]["league"]:
        return jsonify(error="Pas de championnat suivi pour cette équipe."), 404
    return jsonify(services.save_league(_body()))


@bp.put("/league/fixes/<code>")
def put_league_fix(code: str):
    """Correction d'un match de la poule par l'équipe (horaire, salle, rendez-vous) : gardée lors des actualisations."""
    if not current_app.config["STATOR_TEAM"]["league"]:
        return jsonify(error="Pas de championnat suivi pour cette équipe."), 404
    return jsonify(services.save_league_fix(code, _body()))


@bp.put("/league/sheets/<code>")
def put_league_sheet(code: str):
    """Feuille de match d'un match joué de l'équipe, lue sur le site FFVolley par stator/ffvb.py."""
    if not current_app.config["STATOR_TEAM"]["league"]:
        return jsonify(error="Pas de championnat suivi pour cette équipe."), 404
    return jsonify(services.save_league_sheet(code, _body()))


@bp.get("/league/sheets/<code>")
def get_league_sheet(code: str):
    sheet = services.league_sheet(code) if current_app.config["STATOR_TEAM"]["league"] else None
    if sheet is None:
        return jsonify(error="Pas de feuille de match pour ce match."), 404
    return jsonify(sheet)


@bp.post("/league/sheets/<code>/squad")
def post_league_sheet_squad(code: str):
    """Reprend les joueurs de la feuille de match dans le match de l'app (après un ajout dans l'effectif)."""
    m = services.match_for_code(code) if current_app.config["STATOR_TEAM"]["league"] else None
    if m is None or services.league_sheet(code) is None:
        return jsonify(error="Pas de match de l'app ou pas de feuille pour ce match."), 404
    squad = services.apply_sheet_squad(code, m)
    return jsonify(squad=squad, match=services.match_doc(m))


@bp.put("/sporteasy")
def put_sporteasy():
    """Membres et réponses aux convocations des prochains matchs, lus sur SportEasy par stator/sporteasy.py."""
    if not current_app.config["STATOR_TEAM"]["league"]:
        return jsonify(error="Pas de championnat suivi pour cette équipe."), 404
    return jsonify(services.save_sporteasy(_body()))


@bp.post("/sporteasy/dates/<code>")
def post_sporteasy_date(code: str):
    """SportEasy et l'app n'ont pas la même date pour ce match : l'équipe choisit laquelle garder."""
    if not current_app.config["STATOR_TEAM"]["league"]:
        return jsonify(error="Pas de championnat suivi pour cette équipe."), 404
    return jsonify(services.choose_se_date(code, str(_body().get("keep") or "")))
