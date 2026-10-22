# Mettre ASVP Stator en ligne sur PythonAnywhere

L'app tourne sur PythonAnywhere (serveur européen) et sa base de données est un fichier,
`instance/stator.db`, qui reste sur leur disque toute la saison. Le code vient de GitHub : on
modifie l'app sur son PC, on pousse sur GitHub, puis une commande met le serveur à jour.

```
PC (modifs + tests) ──git push──▶ GitHub ──bash deploy/mise-a-jour.sh──▶ PythonAnywhere
```

## 1. Première installation (une seule fois)

### a. Compte et accès au dépôt

1. Créer un compte gratuit (*Beginner*) sur **https://eu.pythonanywhere.com**.
2. Le dépôt GitHub est privé : créer un jeton d'accès en lecture seule. Sur GitHub :
   *Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token*,
   *Repository access* : seulement `ASVP_STATOR`, *Permissions › Contents* : **Read-only**.
   Copier le jeton.

### b. Récupérer le code

Sur PythonAnywhere, onglet **Consoles › Bash** :

```bash
git config --global credential.helper store      # retient le jeton pour les mises à jour
git clone https://github.com/Samuel-Scalbert/ASVP_STATOR.git
# Username : Samuel-Scalbert   Password : coller le jeton
mkvirtualenv --python=python3.12 stator           # ou la version de Python la plus récente proposée
pip install -r ~/ASVP_STATOR/requirements.txt
```

### c. Créer l'app web

Onglet **Web › Add a new web app** › *Next* › **Manual configuration** › même version de Python.
Puis, sur la page de l'app :

- **Virtualenv** : `/home/TON_PSEUDO/.virtualenvs/stator`
- **WSGI configuration file** : ouvrir le lien, tout effacer, coller le contenu de
  [`deploy/wsgi_pythonanywhere.py`](deploy/wsgi_pythonanywhere.py), enregistrer.
- Cliquer sur **Reload**.

L'app est en ligne sur `https://TON_PSEUDO.eu.pythonanywhere.com`. La base est créée vide au
premier lancement : saisir l'effectif dans l'onglet **Équipe**. Pour repartir d'une base existante,
l'envoyer avant le *Reload* avec l'onglet **Files** dans `~/ASVP_STATOR/instance/stator.db`.

## 2. Mettre à jour l'app

1. **Sur le PC** : faire les modifications, tester (`flask --app stator run`), puis
   `git commit` et `git push`. Pour une nouvelle version notable, changer aussi le numéro dans
   le fichier [`VERSION`](VERSION) (par exemple 1.0.0 → 1.1.0).
2. **Sur PythonAnywhere**, dans une console Bash :

   ```bash
   bash ~/ASVP_STATOR/deploy/mise-a-jour.sh
   ```

   Le script sauvegarde la base, récupère la dernière version, met à jour les dépendances et
   redémarre l'app. Il affiche à la fin la version en ligne.

La base n'est jamais remplacée par une mise à jour : `instance/` n'est pas dans GitHub. Si une
version ajoute des informations (par exemple une colonne), l'app met la base à niveau toute seule
au démarrage.

## 3. Vérifier que le serveur a la bonne version

L'app affiche sa version en bas du menu latéral et dans l'onglet **Équipe** :
`Version 1.0.0 · 5921122`. Le code après le point (`5921122`) est le commit qui tourne sur le
serveur. Il doit être identique au dernier commit affiché sur la page du dépôt GitHub. S'il est
différent, le serveur n'est pas à jour : relancer le script de mise à jour.

## 4. Sauvegardes

- **Automatiques** : avant chaque mise à jour, dans `~/ASVP_STATOR/instance/sauvegardes/`
  (les 20 dernières sont gardées).
- **Chez soi** : de temps en temps (par exemple après chaque match), onglet **Files**, dossier
  `ASVP_STATOR/instance`, télécharger `stator.db`. C'est la seule copie à l'abri d'un problème chez
  l'hébergeur.

**Restaurer une sauvegarde** (console Bash) :

```bash
cd ~/ASVP_STATOR
cp instance/stator.db instance/sauvegardes/stator-avant-restauration.db
cp instance/sauvegardes/NOM_DE_LA_SAUVEGARDE.db instance/stator.db
touch /var/www/*_wsgi.py                     # redémarre l'app
```

**Revenir à la version précédente du code** si une mise à jour pose problème :

```bash
cd ~/ASVP_STATOR
git log --oneline -5                         # repérer le commit précédent
git checkout CODE_DU_COMMIT && touch /var/www/*_wsgi.py
# pour revenir ensuite à la dernière version :  git checkout main && bash deploy/mise-a-jour.sh
```

## 5. Rester en ligne toute la saison

- **Offre gratuite** : l'app s'arrête si elle n'est pas prolongée chaque mois. Onglet **Web**,
  bouton *Run until 1 month from today*. Mettre un rappel mensuel. Les données ne sont pas
  perdues si on oublie, mais le site est coupé jusqu'au clic.
- **Offre payante** (*Developer*) : pas d'expiration.

## À savoir avant d'ouvrir l'app à l'équipe

L'app n'a pas encore de mot de passe : toute personne qui a le lien peut modifier ou supprimer
des matchs. Ajouter un mot de passe d'équipe avant de partager l'adresse.
