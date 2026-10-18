# Projet fil rouge AE Hero : DVF

Bienvenue dans ton projet.

Tu pars de la donnée publique **DVF** (Demandes de valeurs foncières, transactions immobilières) et tu construis ta propre modélisation avec dbt et DuckDB, de la donnée brute jusqu'au dashboard, avec une chaîne de CI/CD complète comme en entreprise.

> Il n'y a pas de solution unique. Tout le monde part de la même source, mais **ta modélisation est la tienne**.

## Ce que tu vas construire

- Une chaîne de transformation dbt (staging → intermediate → marts) sur DuckDB
- Des tests de qualité de données et une CI qui passe (lint SQL, `dbt build`, revue de la structure du projet)
- Un déploiement automatique en **preprod** (à chaque push sur `main`) puis en **prod** (à chaque version)
- Un suivi quotidien de la qualité des données avec **Elementary**
- Un **site web** publié sur GitHub Pages: documentation, dashboards, documentation dbt, rapport de qualité et explorateur SQL dans le navigateur
- Un dashboard qui répond à des questions métier

Les consignes, les questions métier et les critères d'évaluation sont dans la formation : <lien vers la page du projet>.

## Prérequis

- Python 3.10 ou plus récent
- Git et un compte GitHub
- Un éditeur (VS Code recommandé)
- Avoir suivi le chapitre Git (clone, branche, PR)

## Démarrage rapide

### 1. Crée ton repo à partir du template

Clique sur **Use this template → Create a new repository** (en haut de cette page), puis clone **ton** repo :

```bash
git clone git@github.com:<ton-pseudo>/<ton-repo>.git
cd <ton-repo>
```

### 2. Crée l'environnement Python

```bash
python -m venv .venv

# Mac / Linux / Git Bash
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

`requirements.txt` installe dbt, DuckDB, SQLFluff et la CLI Elementary. Les dépendances du site (MkDocs) sont dans `docs-requirements.txt` : tu n'en as besoin que pour prévisualiser le site en local.

### 3. Le profil dbt

Le projet dbt se trouve dans `real_estate_analysis/`. Son `profiles.yml` est **versionné** : il ne contient aucun secret (des bases DuckDB locales) et la CI l'utilise. Il définit quatre cibles, une par environnement :

| Cible | Base | Utilisée pour |
|---|---|---|
| `dev` | `dev.duckdb` | ton travail en local (cible par défaut) |
| `ci` | `ci.duckdb` | la CI sur les pull requests |
| `preprod` | `preprod.duckdb` | le déploiement sur `main` |
| `prod` | `prod.duckdb` | le déploiement par version |

La cible se choisit avec la variable `DBT_TARGET` (ou `--target`). Un second profil, `elementary`, sert uniquement à générer le rapport de qualité.

### 4. Lance dbt

Toutes les commandes dbt se lancent depuis `real_estate_analysis/` :

```bash
cd real_estate_analysis
dbt deps
dbt build
```

`dbt build` charge aussi le seed IRIS. Au premier lancement, les données DVF sont téléchargées automatiquement dans `dev.duckdb` (voir ci-dessous).

## Chargement des données

| Données | Table | Chargement |
|---|---|---|
| DVF | `main.dvf` (source) | Macro `load_dvf` en `on-run-start`, téléchargement depuis `files.data.gouv.fr/geo-dvf` |
| Contours IRIS du 59 | `main.iris_59` (seed) | `dbt seed` / `dbt build`, depuis `seeds/iris_59.csv` |

### DVF

La macro `load_dvf` est appelée en `on-run-start` (`dbt_project.yml`) avant chaque `dbt run` / `dbt build` / `dbt test` :

- Elle ne charge que si `main.dvf` **n'existe pas encore** : les lancements suivants ne retéléchargent rien.
- La table est recréée à chaque chargement : pas de doublons.
- Les données ne sont **jamais** commitées (`*.duckdb` est ignoré par Git).

Le périmètre se règle avec des vars, dans `dbt_project.yml` ou en ligne de commande :

| Var | Défaut | Rôle |
|---|---|---|
| `dvf_departements` | `["59"]` | Départements DVF (la Corse se code `"2A"` / `"2B"`) |
| `dvf_years` | `[2022, 2023]` | Années DVF (2021 à 2025 disponibles) |
| `dvf_reload` | `false` | Force le rechargement de `main.dvf` |

```bash
# Changer de périmètre DVF (le reload est nécessaire si la table existe déjà)
dbt build --vars '{dvf_reload: true, dvf_departements: ["59", "62"], dvf_years: [2024, 2025]}'

# Charger sans lancer les modèles
dbt run-operation load_dvf --args '{force: true}'
```

### Contours IRIS

`seeds/iris_59.csv` contient les 1 345 IRIS du département 59, extraits des **Contours IRIS** de l'IGN (GeoPackage national, trop lourd pour être commité : 176 Mo).

- Géométries en WGS84, simplifiées à ~10 m et arrondies à 5 décimales (~1 m) : le fichier pèse 1,5 Mo. C'est largement assez précis pour rattacher une transaction à un IRIS.
- Elles sont stockées en texte (WKT) et converties en géométrie dans `stg_geospacial_coordinates` avec `st_geomfromtext`.
- **Le seed ne couvre que le 59.** Si tu ajoutes des départements à `dvf_departements`, il faut régénérer le seed à partir du GeoPackage.

## Structure du projet

```
.
├── real_estate_analysis/    # projet dbt
│   ├── models/
│   │   ├── staging/         # un modèle par table source : renommage, typage
│   │   ├── intermediate/    # jointures et logique métier
│   │   └── marts/           # tables finales pour l'analyse
│   ├── macros/              # load_dvf (chargement de la source DVF) et tes macros
│   ├── seeds/               # petits fichiers de référence, dont iris_59.csv
│   ├── snapshots/           # historisation des données qui changent
│   ├── tests/               # tests singuliers
│   ├── dbt_project.yml      # hooks on-run-start et vars de chargement
│   ├── packages.yml         # dbt-project-evaluator, Elementary
│   └── profiles.yml         # cibles dev / ci / preprod / prod
├── docs/                    # pages et style du site (MkDocs Material)
├── mkdocs.yml               # configuration du site
├── .github/
│   ├── workflows/           # CI et CD (voir ci-dessous)
│   └── scripts/             # construction du site, export Parquet, …
├── requirements.txt         # dbt, DuckDB, SQLFluff, Elementary
└── docs-requirements.txt    # MkDocs et son thème
```

## Comment travailler

1. Crée une **branche** par étape ou par fonctionnalité.
2. Ouvre une **Pull Request** vers `main` : la CI se lance automatiquement et commente la PR.
3. Fusionne seulement quand la CI est verte.
4. Garde des PR petites (une idée par PR).

## CI/CD : ce qui tourne tout seul

Tu n'as rien à lancer : les workflows (dossier `.github/workflows/`, onglet **Actions** sur GitHub) se déclenchent seuls.

| Quand | Ce qui se passe |
|---|---|
| **Pull request** | Lint **SQLFluff**, `dbt build` avec tests sur la cible `ci`, revue de la structure du projet avec **dbt-project-evaluator** (les écarts font échouer la CI). Les résultats sont commentés dans la PR. |
| **Push sur `main`** | Déploiement en **preprod** : `dbt build` sur `preprod`, la base `preprod.duckdb` et les dashboards sont publiés dans la release `db-preprod`, puis le site est reconstruit. |
| **Version (tag `v*`)** | Déploiement en **prod**, même principe avec la release `db-prod`. |
| **Tous les jours** | « dbt run daily » : `dbt build` sur preprod (et prod), tests et **Elementary** inclus, puis republication de la base. |
| **Changement de la doc ou du site** | Reconstruction et publication du site sur GitHub Pages. |

### Publier en production

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Premiers pas sur GitHub

Dans ton repo, avant le premier push sur `main` :

1. **Settings → Pages** : choisis **Source : GitHub Actions**.
2. **Settings → Actions → General** : active les workflows, et dans *Workflow permissions* choisis **Read and write permissions** (les déploiements publient les bases dans des releases).
3. Après le premier déploiement, les workflows planifiés (« dbt run daily ») ne démarrent que si les Actions sont activées sur ton repo. Si tu as créé ton repo depuis un template, ouvre l'onglet **Actions** et active-les.

Les workflows quotidiens téléchargent la base d'une release existante : ils échouent tant que le premier déploiement n'a pas eu lieu.

## Le site

Une fois publié, ton site est à `https://<ton-pseudo>.github.io/<ton-repo>/`, avec **deux versions** :

- `/preprod/` : reflète la branche `main`
- `/prod/` : reflète la dernière version publiée (vide tant que tu n'as pas poussé de tag `v*`)

Chaque version contient :

| Page | Contenu |
|---|---|
| **Accueil** | Présentation du projet, stack, organisation, workflow |
| **Dashboards** | Tes dashboards (dbt Charts), intégrés dans la page |
| **Documentation dbt** | Lineage, description des modèles et colonnes (`dbt docs`) |
| **Qualité des données** | Rapport **Elementary** : résultats des tests, historique des exécutions |
| **Explorateur SQL** | Requêtes SQL dans le navigateur (DuckDB-WASM) sur les tables publiées en Parquet |

Pour personnaliser les pages, modifie `docs/` (texte, pages) et `docs/stylesheets/` (couleurs et mise en page), puis pousse sur `main`.

### Prévisualiser en local

```bash
pip install -r docs-requirements.txt
mkdocs serve
```

Les pages Dashboards, Documentation dbt et Qualité des données n'affichent leur contenu que sur le site publié, car il est généré par le déploiement.

### L'explorateur SQL

Il lit les tables en Parquet publiées avec le site. Les tables volumineuses sont **échantillonnées**. Pour travailler sur la base complète, télécharge `preprod.duckdb` ou `prod.duckdb` depuis les releases `db-preprod` / `db-prod` et ouvre-la avec DuckDB.

## Qualité des données

- **Tests dbt** : à écrire dans tes `schema.yml` et dans `tests/`. Ils tournent à chaque `dbt build`, en CI et au quotidien.
- **dbt-project-evaluator** : vérifie les bonnes pratiques de structure (nommage, dépendances, documentation). En CI, ses écarts font échouer le build.
- **Elementary** : enregistre dans la base les résultats de chaque exécution (schéma `main_elementary`). Le rapport est sur la page *Qualité des données*. Il se remplit après la première exécution complète avec tests. Tu peux y ajouter des tests de détection d'anomalies (`elementary.volume_anomalies`, `elementary.schema_changes`, …).

## Ce que tu dois rendre

- Le lien vers ton **repo public** : <TBD>
- Date limite : **4 semaines après avoir regardé le dernier module d'AE Hero**
- Le repo doit contenir :
  - un **README** (objectif, architecture, comment relancer le projet)
  - tes **tests dbt** et ta **CI** qui passent
  - un **dashboard** fonctionnel, publié avec le site
  - une courte section sur tes **choix de modélisation** et leurs compromis

Les critères d'évaluation complets sont dans la formation.

## Avant de rendre un repo public

Passe par `PRE_PUBLISH_CHECKLIST.md`. En résumé :

- [ ] Aucun secret ni jeton dans le repo (le `profiles.yml` fourni n'en contient pas)
- [ ] Aucun fichier de données ni fichier `.duckdb` commité
- [ ] README complet, CI verte, GitHub Pages activé, site `/preprod/` en ligne
- [ ] Aucun contenu réservé aux goodies de la formation

## Problèmes fréquents

| Symptôme | Piste |
|---|---|
| `Could not find profile named 'real_estate_analysis'` | Tu lances dbt hors de `real_estate_analysis/`, ou le nom du profil ne correspond pas à `dbt_project.yml`. |
| `Could not find profile named 'elementary'` | Le profil `elementary` manque dans `profiles.yml` : il est nécessaire pour générer le rapport de qualité. |
| `Catalog Error: Table with name dvf does not exist` | Le hook de chargement n'a pas tourné : lance `dbt build` depuis `real_estate_analysis/`, ou `dbt run-operation load_dvf`. |
| `... is not in the catalog, but it exists in the spatial extension` | Ajoute `spatial` dans `extensions` du profil de ta cible. |
| `Could not set lock on file ... dev.duckdb` | Ferme les autres connexions à la base (UI DuckDB, extension VS Code), puis relance. |
| `dbt: command not found` ou `edr: command not found` | L'environnement virtuel n'est pas activé, ou `pip install -r requirements.txt` n'a pas été lancé. |
| Le téléchargement DVF échoue | Vérifie ta connexion et l'URL `files.data.gouv.fr/geo-dvf/latest/csv/`, puis relance avec `--vars '{dvf_reload: true}'`. |
| La CI échoue mais `dbt build` passe en local | Compare les versions de Python et des paquets avec `requirements.txt`. |
| La CI SQLFluff échoue | Lance `sqlfluff fix` sur le fichier indiqué, relis la différence, puis recommite. |
| La CI échoue sur dbt-project-evaluator | Lis la liste des écarts dans le commentaire de la PR : chaque ligne dit quel modèle corriger et pourquoi. |
| Le site n'apparaît pas | Vérifie que GitHub Pages est configuré sur **GitHub Actions** et que le workflow « Deploy site » est vert. |
| `/prod/` est vide | Normal tant qu'aucun tag `v*` n'a été poussé et que le déploiement prod n'a pas fini. |
| L'explorateur affiche « Aucune donnée publiée » | Le déploiement n'a pas encore publié les tables : regarde le log *Build one site per environment* du workflow « Deploy site ». |
| La page *Qualité des données* affiche « Pas encore disponible » | Le rapport n'a pas pu être généré : regarde l'avertissement `rapport Elementary non généré` dans le même log. |
| Le workflow « dbt run daily » échoue au téléchargement | La release `db-preprod` (ou `db-prod`) n'existe pas encore : fais d'abord un push sur `main` (ou un tag `v*`) et attends la fin du déploiement. |

Une question ? Pose-la sur la communauté AE Hero, avec le message d'erreur complet.

## Source des données et licence

Les données DVF sont publiées par la DGFiP et mises à disposition sur [data.gouv.fr](https://www.data.gouv.fr) sous **Licence Ouverte**. Les contours IRIS sont produits par l'IGN et l'INSEE. Cite les sources si tu publies des résultats.