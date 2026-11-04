"""Lecture et écriture des données au format échangé avec l'interface (mêmes documents
que la version artefact : config, matches, stats)."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime

from .models import Match, Player, SetScore, Setting, StatCount, StatSheet, db, utcnow
from .referentiel import field_ids

ID_RE = re.compile(r"^[A-Za-z0-9_\-.~:@+]{1,170}$")
VENUES = {"", "dom", "ext"}
VIDEO_KINDS = {"", "lien", "discord"}
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
SOURCES = {"app", "excel"}


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
        "time": m.match_time or "",
        "venue": m.venue or "", "competition": m.competition or "", "video": m.video_url or "",
        "squad": [p for p in (m.squad or "").split(",") if p],
        "noData": bool(m.no_data),
        "videoKind": m.video_kind or ("lien" if m.video_url else ""),
        "videoNote": m.video_note or "",
        "closed": bool(m.closed),
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
        "source": s.source or "app",
        "excel": json.loads(s.excel_json) if s.excel_json else None,
        "updatedAt": _iso(s.updated_at),
    }


def league_doc() -> dict | None:
    raw = get_setting("league")
    return json.loads(raw) if raw else None


def state() -> dict:
    by_id = {v: k for k, v in field_ids().items()}
    matches = db.session.scalars(db.select(Match)).all()
    sheets = db.session.scalars(db.select(StatSheet)).all()
    return {
        "config": config_doc(),
        "matches": {m.id: match_doc(m) for m in matches},
        "stats": {s.id: sheet_doc(s, by_id) for s in sheets},
        "league": league_doc(),
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
    if "time" in doc:  # une page d'avant l'heure n'envoie pas ce champ : on garde l'heure déjà enregistrée
        time = str(doc.get("time") or "").strip()
        if time and not TIME_RE.match(time):
            raise InvalidData("Heure du match invalide (format 20:30).")
        m.match_time = time
    m.venue = venue
    m.competition = str(doc.get("competition") or "")[:120]
    video = str(doc.get("video") or "").strip()
    kind = doc.get("videoKind")
    if kind is None:  # anciens clients : un lien suffit à dire qu'il y a une vidéo
        kind = "lien" if video else ""
    if kind not in VIDEO_KINDS:
        raise InvalidData("Type de vidéo invalide.")
    if kind == "lien" and not re.match(r"^https?://", video):
        raise InvalidData("Le lien de la vidéo doit commencer par http:// ou https://.")
    m.video_kind = kind
    m.video_url = video[:300] if kind == "lien" else ""
    m.video_note = str(doc.get("videoNote") or "").strip()[:200] if kind == "discord" else ""
    m.closed = doc.get("closed") is True
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


def _parse_sets(sets) -> list[tuple[int, str, int]]:
    """Valide des comptages {"1": {"service": {"decisif": 2}}} et renvoie [(set, id de stat, nombre)]."""
    if sets is None:
        return []
    if not isinstance(sets, dict):
        raise InvalidData("Format des sets invalide.")
    fields = field_ids()
    out = []
    for set_key, per_skill in sets.items():
        set_no = _int(int(set_key) if str(set_key).isdigit() else -1, "Numéro de set", 1, 5)
        for skill, per_field in (per_skill or {}).items():
            for key, n in (per_field or {}).items():
                fid = fields.get((skill, key))
                if fid is None:
                    raise InvalidData(f"Stat inconnue du référentiel : {skill}.{key}.")
                n = _int(n, f"{skill}.{key}", 0, 999)
                if n:
                    out.append((set_no, fid, n))
    return out


def _excel_version(excel) -> str:
    """Version Excel en attente (ou refusée) d'une fiche, validée puis stockée en JSON."""
    if not excel:
        return ""
    if not isinstance(excel, dict) or excel.get("status") not in ("pending", "refused"):
        raise InvalidData("Version Excel invalide.")
    _parse_sets(excel.get("sets"))
    bilan = excel.get("bilan") or {}
    clean = {
        "status": excel["status"],
        "sets": excel.get("sets") or {},
        "bilan": {k: str(bilan.get(k) or "") for k in ("pp", "pm", "cp", "cm")},
        "file": str(excel.get("file") or "")[:200],
        "at": str(excel.get("at") or "")[:40],
    }
    return json.dumps(clean, ensure_ascii=False)


def save_sheet(sheet_id: str, doc: dict) -> StatSheet:
    match_id = _check_id(doc.get("matchId"), "match")
    player_id = _check_id(doc.get("playerId"), "joueur")
    if sheet_id != f"{match_id}__{player_id}":
        raise InvalidData("L'identifiant de la fiche ne correspond pas au match et au joueur.")
    if db.session.get(Match, match_id) is None:
        raise InvalidData("Ce match n'existe pas (il a peut-être été supprimé).")
    ensure_player(player_id)
    counts = [StatCount(set_no=n, field_id=fid, count=c) for n, fid, c in _parse_sets(doc.get("sets"))]
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
    source = doc.get("source") or "app"
    if source not in SOURCES:
        raise InvalidData("Origine de la fiche invalide.")
    sheet.source = source
    sheet.excel_json = _excel_version(doc.get("excel"))
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


# ---------------------------------------------------------------- championnat FFVolley
# Une seule ligne (réglage « league »), remplacée à chaque actualisation par stator/ffvb.py : les matchs
# de la poule avec leurs scores. Le classement et les statistiques sont recalculés par la page.
SEASON_RE = re.compile(r"^\d{4}/\d{4}$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{1,12}$")
LEAGUE_CODE_RE = re.compile(r"^[A-Z0-9]{2,8}\d{3}$")


def _text(value, what: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise InvalidData(f"Championnat : {what} invalide.")
    return value.strip()


def _league_matches(items, what: str) -> list[dict]:
    if not isinstance(items, list) or len(items) > 400:
        raise InvalidData(f"Championnat : liste des matchs ({what}) invalide.")
    out = []
    for m in items:
        if not isinstance(m, dict) or not LEAGUE_CODE_RE.match(str(m.get("code") or "")):
            raise InvalidData(f"Championnat : match invalide ({what}).")
        day, hour = m.get("date") or "", m.get("time") or ""
        if day:
            _parse_date(day)
        if hour and not TIME_RE.match(hour):
            raise InvalidData(f"Championnat : heure invalide ({m['code']}).")
        sets = m.get("sets") or []
        if not isinstance(sets, list) or len(sets) > 5 or not all(isinstance(s, list) and len(s) == 2 for s in sets):
            raise InvalidData(f"Championnat : score des sets invalide ({m['code']}).")
        doc = {"code": m["code"], "round": _int(m.get("round") or 0, "Journée", 0, 99), "date": day, "time": hour,
               "home": _text(m.get("home"), "équipe", 60, True), "away": _text(m.get("away"), "équipe", 60, True),
               "sets": [[_int(a, "Score de set"), _int(b, "Score de set")] for a, b in sets]}
        gym = _text(m.get("gym"), "salle", 80)
        if gym:
            doc["gym"] = gym
        out.append(doc)
    return out


def _adjust(value) -> dict:
    if not isinstance(value, dict) or len(value) > 40:
        raise InvalidData("Championnat : écarts de points invalides.")
    return {_text(t, "équipe", 60, True): _int(p, "Écart de points", -50, 50) for t, p in value.items()}


def save_league(doc: dict) -> dict:
    src = doc.get("source") or {}
    if not (isinstance(src, dict) and SEASON_RE.match(str(src.get("season") or ""))
            and CODE_RE.match(str(src.get("codent") or "")) and CODE_RE.match(str(src.get("poule") or ""))):
        raise InvalidData("Championnat : source FFVolley invalide (saison, codent, poule).")
    teams = doc.get("teams") or {}
    gyms = doc.get("gyms") or {}
    if not isinstance(teams, dict) or len(teams) > 40 or not isinstance(gyms, dict) or len(gyms) > 80:
        raise InvalidData("Championnat : équipes ou salles invalides.")
    clean = {
        "source": {"season": src["season"], "codent": src["codent"], "poule": src["poule"]},
        "title": _text(doc.get("title"), "titre", 160),
        "team": _text(doc.get("team"), "équipe", 60, True),
        "updatedAt": _text(doc.get("updatedAt"), "date de mise à jour", 40),
        "matches": _league_matches(doc.get("matches"), "saison en cours"),
        "adjust": _adjust(doc.get("adjust") or {}),
        "teams": {},
        "gyms": {_text(g, "salle", 80, True): _text(a, "adresse", 160) for g, a in gyms.items()},
        "previous": None,
    }
    for name, info in teams.items():
        if not isinstance(info, dict):
            raise InvalidData("Championnat : équipe invalide.")
        site = _text(info.get("site"), "site du club", 200)
        if site and not re.match(r"^https?://", site):
            raise InvalidData("Championnat : site du club invalide.")
        t = {k: v for k, v in {"club": _text(info.get("club"), "club", 80), "colors": _text(info.get("colors"), "couleurs", 60),
                               "site": site}.items() if v}
        if t:
            clean["teams"][_text(name, "équipe", 60, True)] = t
    prev = doc.get("previous")
    if prev:
        if not isinstance(prev, dict) or not SEASON_RE.match(str(prev.get("season") or "")):
            raise InvalidData("Championnat : saison précédente invalide.")
        clean["previous"] = {"season": prev["season"], "title": _text(prev.get("title"), "titre", 160),
                             "matches": _league_matches(prev.get("matches"), "saison précédente"),
                             "adjust": _adjust(prev.get("adjust") or {})}
    s = db.session.get(Setting, "league") or Setting(key="league")
    s.value = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    db.session.add(s)
    db.session.commit()
    return clean
