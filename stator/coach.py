"""Profil du coach : un mot de passe qui lui ouvre ses deux équipes et le sélecteur pour passer de l'une à l'autre.

Le profil est un fichier du serveur, instance/coach.json, qui n'est pas dans GitHub :
    {"name": "Coach", "password": "<empreinte du mot de passe>", "teams": ["asvp", "f4"]}
Le créer ou changer le mot de passe, sur le PC ou dans une console de PythonAnywhere :
    python -m stator.coach
La connexion est gardée dans un cookie signé, commun à toutes les équipes du site (même clé secrète).
"""
from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import secrets
import sys
import time
from pathlib import Path

from flask import current_app, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .teams import TEAMS

INSTANCE_DIR = Path(__file__).resolve().parent.parent / "instance"
MAX_FAILS, LOCK_SECONDS = 5, 300
_fails: dict[str, list[float]] = {}  # adresse IP -> instants des derniers échecs


def secret_key(instance: Path) -> str:
    """Clé qui signe le cookie de connexion : créée une fois, gardée dans instance/secret_key."""
    path = instance / "secret_key"
    try:
        key = path.read_text(encoding="utf-8").strip()
        if key:
            return key
    except OSError:
        pass
    key = secrets.token_hex(32)
    path.write_text(key, encoding="utf-8")
    return key


def profile() -> dict | None:
    """Le profil du coach (instance/coach.json), ou None s'il n'a pas encore été créé."""
    path = Path(current_app.config["COACH_PROFILE"])
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("password") else None


def _fingerprint(p: dict) -> str:
    """Marque de connexion gardée dans le cookie : liée au mot de passe actuel (le changer déconnecte partout),
    sans rien révéler de son empreinte (le cookie est signé, pas chiffré)."""
    key = str(current_app.secret_key).encode()
    return hmac.new(key, p["password"].encode(), hashlib.sha256).hexdigest()[:32]


def is_coach() -> bool:
    p = profile()
    token = session.get("coach")
    return bool(p and isinstance(token, str) and hmac.compare_digest(token, _fingerprint(p)))


def _teams_doc(p: dict) -> list[dict]:
    """Les équipes du coach avec leur adresse, calculée depuis celle de l'équipe affichée."""
    here = current_app.config["STATOR_TEAM"]
    base = request.script_root[: len(request.script_root) - len(here["prefix"])] if here["prefix"] else request.script_root
    out = []
    for key in p.get("teams") or list(TEAMS):
        t = TEAMS.get(key)
        if t:
            out.append({"key": key, "name": t["name"], "logo": t["logo"], "url": base + t["prefix"] + "/",
                        "current": key == here["key"]})
    return out


def state_doc() -> dict:
    """Ce que la page sait du coach : profil créé ou non, et, s'il est connecté, ses équipes."""
    p = profile()
    if not p:
        return {"available": False, "coach": None}
    if not is_coach():
        return {"available": True, "coach": None}
    return {"available": True, "coach": {"name": p.get("name") or "Coach", "teams": _teams_doc(p)}}


def login(password: str) -> tuple[bool, str]:
    p = profile()
    if not p:
        return False, "Le profil coach n'a pas encore été créé sur ce serveur (python -m stator.coach)."
    ip = request.remote_addr or "?"
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < LOCK_SECONDS]
    if len(recent) >= MAX_FAILS:
        return False, "Trop d'essais : réessaie dans quelques minutes."
    if not isinstance(password, str) or not check_password_hash(p["password"], password):
        _fails[ip] = recent + [now]
        return False, "Mot de passe incorrect."
    _fails.pop(ip, None)
    session.clear()
    session.permanent = True
    session["coach"] = _fingerprint(p)
    return True, ""


def logout() -> None:
    session.pop("coach", None)


def main(argv: list[str]) -> int:
    """Crée ou modifie le profil coach (instance/coach.json)."""
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    path = INSTANCE_DIR / "coach.json"
    try:
        old = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        old = {}
    print("Profil coach :", "modification" if old else "création", f"({path})")
    name = input(f"Nom affiché [{old.get('name') or 'Coach'}] : ").strip() or old.get("name") or "Coach"
    while True:
        pw = getpass.getpass("Mot de passe (8 caractères au moins) : ")
        if len(pw) < 8:
            print("Trop court.")
        elif getpass.getpass("Encore une fois : ") != pw:
            print("Les deux saisies diffèrent.")
        else:
            break
    doc = {"name": name[:60], "password": generate_password_hash(pw), "teams": old.get("teams") or list(TEAMS)}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Profil enregistré : {doc['name']}, équipes {', '.join(doc['teams'])}.")
    print("Sur PythonAnywhere, recharger l'app (onglet Web, Reload) n'est pas nécessaire : le fichier est relu à chaque page.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
