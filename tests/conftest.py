import pytest

from stator import create_app
from stator.models import db


@pytest.fixture()
def app(tmp_path):
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp_path / 'test.db'}"})
    yield app
    with app.app_context():
        db.engine.dispose()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def team(client):
    """Une équipe de deux joueurs et un match."""
    client.put("/api/config", json={"team": "ASVP", "season": "2026-2027", "roster": [
        {"id": "joueur-a", "name": "Joueur A", "active": True, "poste": "central"},
        {"id": "joueur-b", "name": "Joueur B", "active": True, "poste": "libero"},
    ]})
    client.put("/api/matches/m-exemple", json={"opponent": "Club Exemple", "date": "2026-10-18", "venue": "dom",
                                              "sets": [{"a": 25, "o": 18}, {"a": 25, "o": 20}, {"a": 25, "o": 15}]})
    return client
