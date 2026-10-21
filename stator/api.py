"""API REST consommée par l'interface (web/js/store.js)."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from . import referentiel, services
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
    return jsonify(ok=True)


@bp.get("/state")
def get_state():
    return jsonify(services.state())


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
