"""Référentiel des stats (web/referentiel.json), partagé avec l'interface."""
from __future__ import annotations

import json
from pathlib import Path

from flask import current_app

from .models import StatField, db


def load() -> dict:
    return json.loads(Path(current_app.config["REFERENTIEL_PATH"]).read_text(encoding="utf-8"))


def field_rows(ref: dict) -> list[dict]:
    """Une ligne par stat comptable, dans l'ordre du référentiel."""
    rows, order = [], 0
    for skill in ref["skills"]:
        for f in skill["fields"]:
            oc = skill["outcomes"][f["outcome"]]
            order += 1
            rows.append({
                "id": f"{skill['key']}.{f['key']}",
                "skill": skill["key"],
                "skill_label": skill["label"],
                "field_key": f["key"],
                "outcome": f["outcome"],
                "outcome_label": oc["label"],
                "court_position": f.get("court_position"),
                "level": oc["level"],
                "points": oc.get("points", 0),
                "is_success": f["outcome"] in skill["success"],
                "excel_row": f.get("excel_row"),
                "sort_order": order,
            })
    return rows


def sync_fields() -> None:
    """Recopie le référentiel dans la table stat_fields.

    Une stat retirée du référentiel n'est pas supprimée (des comptages peuvent
    la référencer) : elle est marquée in_referentiel = 0.
    """
    rows = field_rows(load())
    known = {f.id: f for f in db.session.scalars(db.select(StatField))}
    for row in rows:
        field = known.pop(row["id"], None) or StatField(id=row["id"])
        for k, v in row.items():
            setattr(field, k, v)
        field.in_referentiel = True
        db.session.add(field)
    for stale in known.values():
        stale.in_referentiel = False
    db.session.commit()
    current_app.extensions["stator_fields"] = {(r["skill"], r["field_key"]): r["id"] for r in rows}


def field_ids() -> dict[tuple[str, str], str]:
    """(geste, stat) -> id de stat_fields, pour les stats actuellement au référentiel."""
    return current_app.extensions["stator_fields"]
