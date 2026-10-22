#!/bin/bash
# Met l'app en ligne à jour avec la dernière version de GitHub.
# À lancer dans une console Bash de PythonAnywhere :  bash ~/ASVP_STATOR/deploy/mise-a-jour.sh
set -euo pipefail

PROJET="$HOME/ASVP_STATOR"
VENV="$HOME/.virtualenvs/stator"
GARDER=20  # nombre de sauvegardes conservées

# Tout est dans une fonction : le script est lu en entier avant que « git pull » ne le remplace.
main() {
  cd "$PROJET"

  if [ ! -d .git ]; then
    echo "Le dossier $PROJET n'a pas été installé avec « git clone » (fichiers envoyés ou ZIP) :"
    echo "il ne peut pas récupérer les mises à jour. Réinstalle-le avec git, voir DEPLOIEMENT.md, partie 1b :"
    echo "  cd ~ && mv ASVP_STATOR ASVP_STATOR_ancien"
    echo "  git clone https://github.com/Samuel-Scalbert/ASVP_STATOR.git"
    echo "puis remets ta base si tu en avais une :  cp ASVP_STATOR_ancien/instance/stator.db ASVP_STATOR/instance/"
    exit 1
  fi

  echo "1/4 Sauvegarde de la base"
  mkdir -p instance/sauvegardes
  if [ -f instance/stator.db ]; then
    local copie="instance/sauvegardes/stator-avant-maj-$(date +%Y-%m-%d_%H%M%S).db"
    # Copie sûre même si quelqu'un est en train de saisir (sauvegarde intégrée de SQLite).
    "$VENV/bin/python" -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" \
      instance/stator.db "$copie"
    echo "    copie : $copie"
    ls -1t instance/sauvegardes/stator-avant-maj-*.db | tail -n +$((GARDER + 1)) | xargs -r rm --
  else
    echo "    pas encore de base : rien à sauvegarder"
  fi

  echo "2/4 Récupération de la dernière version sur GitHub"
  git pull --ff-only

  echo "3/4 Dépendances"
  "$VENV/bin/pip" install --quiet -r requirements.txt

  echo "4/4 Redémarrage de l'app"
  local wsgi
  wsgi=$(ls /var/www/*_wsgi.py 2>/dev/null | head -n 1 || true)
  if [ -n "$wsgi" ]; then
    touch "$wsgi"
    echo "    app redémarrée"
  else
    echo "    fichier WSGI introuvable : clique sur « Reload » dans l'onglet Web"
  fi

  echo
  echo "Version en ligne : $(cat VERSION) · commit $(git log -1 --format='%h du %cs : %s')"
  echo "Elle doit correspondre au dernier commit affiché sur GitHub."
}

main "$@"
