# Fichier WSGI pour PythonAnywhere : copier tout ce contenu dans le fichier WSGI de l'onglet Web
# (lien « WSGI configuration file »), à la place de ce qui s'y trouve.
import os
import sys

PROJET = os.path.expanduser("~/ASVP_STATOR")
if PROJET not in sys.path:
    sys.path.insert(0, PROJET)

from stator import create_app  # noqa: E402

application = create_app()
