"""Les équipes servies par l'app : une base de données par équipe, une adresse par équipe.

L'ASVP (6x6) reste à la racine du site, avec sa base habituelle instance/stator.db. Chaque autre équipe est
servie sous son préfixe (ex. /f4/) avec sa propre base (instance/stator-f4.db) : les données ne se
mélangent jamais. Seul le coach (voir coach.py) voit les deux équipes et passe de l'une à l'autre.

Pour ajouter une équipe : une entrée dans TEAMS, avec un préfixe et un fichier de base qui lui sont propres.
"""
from __future__ import annotations

TEAMS: dict[str, dict] = {
    "asvp": {
        "key": "asvp",
        "prefix": "",                 # à la racine du site
        "db": "stator.db",
        "short": "ASVP",              # nom court : tableaux de score, « ASVP – adversaire », fichiers Excel
        "name": "ASVP Alsa Team",
        "app": "ASVP Stator",
        "format": 6,                  # 6x6 : six sur le terrain et un libéro
        "gender": "m",
        "league": True,               # championnat FFVolley (stator/ffvb.py) et logos des clubs adverses
        "logo": "img/logo-asvp.png",
        "icons": True,                # icônes PNG de l'app installée sur téléphone (img/icon-*.png)
        "roles": None,                # postes du référentiel (web/referentiel.json) tels quels
        "css": None,                  # couleurs du logo de l'ASVP (index.html)
        "theme_color": "#0b1526",     # barre du navigateur sur téléphone
    },
    "f4": {
        # Équipe féminine 4x4 du même coach. Nom, logo et couleurs sont provisoires : à remplacer quand le
        # club sera connu (le nom se change aussi dans l'onglet Équipe de l'app).
        "key": "f4",
        "prefix": "/f4",
        "db": "stator-f4.db",
        "short": "4x4 F",
        "name": "Équipe féminine 4x4",
        "app": "Stator 4x4",
        "format": 4,                  # 4x4 en losange : pointe avant 3, ailes 4 et 2, pointe arrière 1 ; pas de libéro
        "gender": "f",
        "league": False,              # pas de données reprises d'Internet pour cette équipe
        "logo": "img/logo-f4.svg",
        "icons": False,
        "roles": [
            {"key": "passeur", "label": "Passeuse"},
            {"key": "r4", "label": "Attaquante"},
            {"key": "central", "label": "Centrale"},
            {"key": "pointu", "label": "Pointue"},
        ],
        # Thème de l'équipe (#00aaff, #00f7ff, #ffd447) : bandeaux, boutons, menu, terrain, en clair et en sombre.
        "css": "css/team-f4.css",
        "theme_color": "#00aaff",
    },
}
DEFAULT_TEAM = "asvp"


def public(team: dict) -> dict:
    """Ce que la page reçoit de l'équipe (window.STATOR_TEAM)."""
    keys = ("key", "short", "name", "app", "format", "gender", "league", "logo")
    return {k: team[k] for k in keys}
