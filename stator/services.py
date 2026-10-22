"""Lecture et écriture des données au format échangé avec l'interface (mêmes documents
que la version artefact : config, matches, stats)."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime

from .models import Match, Player, SetScore, Setting, StatCount, StatSheet, db, utcnow
from .referentiel import field_ids

ID_RE = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,170}$")
VENUES = {"", "dom", "ext"}


class InvalidData(ValueError):
    """Données refusées : le message est renvoyé tel quel à l'interface."""


def slug(text: str) -> str:
    s = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "joueur"


def norm(text: str) -> str:
    s = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _iso(dt: datetime | None) -> str:
    return dt.isoformat(timespec="seconds") + "Z" if dt else ""


def _check_id(value: str, what: str) -> str:
    if not isinstance(value, str) or not ID_RE.match(value):
        raise InvalidData(f"Identifiant de {what} invalide.")
    return value


def _int(value, what: str, lo: int = 0, hi: int = 99) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value or not lo <= value <= hi:
        raise InvalidData(f"{what} : nombre entier attendu entre {lo} et {hi}.")
    return int(value)


# ---------------------------------------------------------------- lecture
def get_setting(key: str, default: str = "") -> str:
    s = db.session.get(Setting, key)
    return s.value if s else default


def config_doc() -> dict | None:
    players = db.session.scalars(db.select(Player).order_by(Player.sort_order, Player.name)).all()
    if not players and not db.session.get(Setting, "team"):
        return None
    return {
        "team": get_setting("team", "ASVP"),
        "season": get_setting("season"),
        "roster": [{"id": p.id, "name": p.name, "active": p.active, **({"poste": p.poste} if p.poste else {})}
                   for p in players],
    }


def match_doc(m: Match) -> dict:
    result = None if m.result_asvp is None or m.result_opp is None else {"a": m.result_asvp, "o": m.result_opp}
    return {
        "id": m.id, "opponent": m.opponent,
        "date": m.match_date.isoformat() if m.match_date else "",
        "venue": m.venue or "", "competition": m.competition or "", "video": m.video_url or "",
        "squad": [p for p in (m.squad or "").split(",") if p],
        "noData": bool(m.no_data),
        "sets": [{"a": s.asvp, "o": s.opp} for s in m.set_scores],
        "result": result, "source": m.source or "",
        "createdAt": _iso(m.created_at), "updatedAt": _iso(m.updated_at),
    }


def sheet_doc(s: StatSheet, field_by_id: dict[str, tuple[str, str]]) -> dict:
    sets: dict[str, dict] = {}
    for c in s.counts:
        skill, key = field_by_id.get(c.field_id, (None, None))
        if skill is None:
            continue
        sets.setdefault(str(c.set_no), {}).setdefault(skill, {})[key] = c.count
    return {
        "id": s.id, "matchId": s.match_id, "playerId": s.player_id, "sets": sets,
        "bilan": {"pp": s.bilan_perso_plus, "pm": s.bilan_perso_moins,
                  "cp": s.bilan_collectif_plus, "cm": s.bilan_collectif_moins},
        "updatedAt": _iso(s.updated_at),
    }


def state() -> dict:
    by_id = {v: k for k, v in field_ids().items()}
    matches = db.session.scalars(db.select(Match)).all()
    sheets = db.session.scalars(db.select(StatSheet)).all()
    return {
        "config": config_doc(),
        "matches": {m.id: match_doc(m) for m in matches},
        "stats": {s.id: sheet_doc(s, by_id) for s in sheets},
    }


# ---------------------------------------------------------------- écriture
def ensure_player(player_id: str, name: str | None = None) -> Player:
    p = db.session.get(Player, player_id)
    if p is None:
        order = (db.session.scalar(db.select(db.func.max(Player.sort_order))) or 0) + 1
        p = Player(id=player_id, name=(name or player_id).strip() or player_id, active=True, sort_order=order)
        db.session.add(p)
    return p


def save_config(doc: dict, roles: set[str]) -> None:
    if not isinstance(doc, dict) or not isinstance(doc.get("roster", []), list):
        raise InvalidData("Configuration d'équipe invalide.")
    for key in ("team", "season"):
        if key in doc:
            s = db.session.get(Setting, key) or Setting(key=key)
            s.value = str(doc.get(key) or "")[:100]
            db.session.add(s)
    for i, item in enumerate(doc.get("roster", [])):
        pid = _check_id(item.get("id"), "joueur")
        name = str(item.get("name") or "").strip()
        if not name:
            raise InvalidData("Chaque joueur doit avoir un nom.")
        poste = item.get("poste") or None
        if poste is not None and poste not in roles:
            raise InvalidData(f"Poste inconnu : {poste}.")
        p = ensure_player(pid, name)
        p.name, p.poste, p.active, p.sort_order = name[:120], poste, item.get("active", True) is not False, i
    db.session.commit()


def _parse_date(value) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise InvalidData("Date invalide (format attendu AAAA-MM-JJ).") from exc


def save_match(match_id: str, doc: dict) -> Match:
    _check_id(match_id, "match")
    opponent = str(doc.get("opponent") or "").strip()
    if not opponent:
        raise InvalidData("Le nom de l'adversaire est obligatoire.")
    venue = doc.get("venue") or ""
    if venue not in VENUES:
        raise InvalidData("Lieu invalide.")
    sets = doc.get("sets") or []
    if not isinstance(sets, list) or len(sets) > 5:
        raise InvalidData("Score des sets invalide.")
    result = doc.get("result")
    m = db.session.get(Match, match_id) or Match(id=match_id, created_at=utcnow())
    m.opponent = opponent[:120]
    m.match_date = _parse_date(doc.get("date"))
    m.venue = venue
    m.competition = str(doc.get("competition") or "")[:120]
    video = str(doc.get("video") or "").strip()
    if video and not re.match(r"^https?://", video):
        raise InvalidData("Le lien de la vidéo doit commencer par http:// ou https://.")
    m.video_url = video[:300]
    squad = doc.get("squad") or []
    if not isinstance(squad, list):
        raise InvalidData("Liste des joueurs du match invalide.")
    m.squad = ",".join(dict.fromkeys(_check_id(p, "joueur") for p in squad))
    m.no_data = doc.get("noData") is True
    if m.no_data and not sets and not isinstance(result, dict):
        raise InvalidData("Un match NO VIDEO / NO DATA doit avoir son score : le détail des sets ou le résultat en sets.")
    m.source = str(doc.get("source") or m.source or "")[:200]
    if isinstance(result, dict):
        m.result_asvp = _int(result.get("a"), "Sets gagnés", 0, 3)
        m.result_opp = _int(result.get("o"), "Sets perdus", 0, 3)
    else:
        m.result_asvp = m.result_opp = None
    scores = [SetScore(set_no=i + 1, asvp=_int(s.get("a"), "Score de set"), opp=_int(s.get("o"), "Score de set"))
              for i, s in enumerate(sets)]
    db.session.add(m)
    if m.set_scores:
        m.set_scores.clear()
        db.session.flush()  # libère les clés (match, set) avant de réinsérer
    m.set_scores.extend(scores)
    db.session.commit()
    return m


def delete_match(match_id: str) -> bool:
    m = db.session.get(Match, match_id)
    if m is None:
        return False
    db.session.delete(m)
    db.session.commit()
    return True


def save_sheet(sheet_id: str, doc: dict) -> StatSheet:
    match_id = _check_id(doc.get("matchId"), "match")
    player_id = _check_id(doc.get("playerId"), "joueur")
    if sheet_id != f"{match_id}__{player_id}":
        raise InvalidData("L'identifiant de la fiche ne correspond pas au match et au joueur.")
    if db.session.get(Match, match_id) is None:
        raise InvalidData("Ce match n'existe pas (il a peut-être été supprimé).")
    ensure_player(player_id)
    fields = field_ids()
    counts: list[StatCount] = []
    sets = doc.get("sets") or {}
    if not isinstance(sets, dict):
        raise InvalidData("Format des sets invalide.")
    for set_key, per_skill in sets.items():
        set_no = _int(int(set_key) if str(set_key).isdigit() else -1, "Numéro de set", 1, 5)
        for skill, per_field in (per_skill or {}).items():
            for key, n in (per_field or {}).items():
                fid = fields.get((skill, key))
                if fid is None:
                    raise InvalidData(f"Stat inconnue du référentiel : {skill}.{key}.")
                n = _int(n, f"{skill}.{key}", 0, 999)
                if n:
                    counts.append(StatCount(set_no=set_no, field_id=fid, count=n))
    bilan = doc.get("bilan") or {}
    sheet = db.session.get(StatSheet, sheet_id)
    if sheet is None:
        sheet = StatSheet(id=sheet_id, match_id=match_id, player_id=player_id)
        db.session.add(sheet)
    else:
        sheet.counts.clear()
        db.session.flush()  # supprime les anciens comptages avant d'insérer les nouveaux (même clé primaire)
    sheet.bilan_perso_plus = str(bilan.get("pp") or "")
    sheet.bilan_perso_moins = str(bilan.get("pm") or "")
    sheet.bilan_collectif_plus = str(bilan.get("cp") or "")
    sheet.bilan_collectif_moins = str(bilan.get("cm") or "")
    sheet.updated_at = utcnow()
    sheet.counts.extend(counts)
    db.session.commit()
    return sheet


def delete_sheet(sheet_id: str) -> bool:
    s = db.session.get(StatSheet, sheet_id)
    if s is None:
        return False
    db.session.delete(s)
    db.session.commit()
    return True
