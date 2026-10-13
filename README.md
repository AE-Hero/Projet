# Projet fil rouge AE Hero : DVF

Bienvenue dans ton projet. Tu pars de la donnée publique **DVF** (Demandes de valeurs foncières, transactions immobilières) et tu construis ta propre modélisation avec dbt et DuckDB, de la donnée brute jusqu'au dashboard.

> Il n'y a pas de solution unique. Tout le monde part de la même source, mais **ta modélisation est la tienne**.

## Ce que tu vas construire

- Une chaîne de transformation dbt (staging → intermediate → marts) sur DuckDB
- Des tests de qualité de données et une CI qui passe
- Une documentation publiée (MkDocs + dbt docs) sur GitHub Pages
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

### 3. Configure dbt

Le projet dbt se trouve dans `real_estate_analysis/`. Crée `real_estate_analysis/profiles.yml` :

```yaml
real_estate_analysis:
  target: dev
  outputs:
    dev:
      type: duckdb
      path: dev.duckdb
      threads: 4
      schema: main
      extensions:
        - parquet
        - httpfs    # lecture des fichiers DVF en ligne
        - spatial   # géométries IRIS (st_geomfromtext, st_xmin...)
      settings:
        memory_limit: 4GB
```

`profiles.yml` est ignoré par Git : ne le commite pas.

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
│   ├── packages.yml
│   └── profiles.yml         # à créer, non commité
├── docs/                    # documentation MkDocs
├── .github/workflows/       # CI et publication de la doc
└── requirements.txt
```

## Comment travailler

1. Crée une **branche** par étape ou par fonctionnalité.
2. Ouvre une **Pull Request** vers `main` : la CI lance `dbt build` automatiquement.
3. Fusionne seulement quand la CI est verte.
4. Garde des PR petites (une idée par PR).

## Documentation et dashboard

- **MkDocs** (`docs/`) : explique tes choix d'architecture et de modélisation.
- **dbt docs** : lineage, description des modèles et des colonnes, générée automatiquement.
- **Dashboard** : <instructions pour dbt-chart>.

Publication sur GitHub Pages :

1. Va dans **Settings → Pages**.
2. Choisis **Source : GitHub Actions**.
3. Pousse sur `main` : le workflow publie la doc.

## Ce que tu dois rendre

- Le lien vers ton **repo public** : <TBD>
- Date limite : **4 semaines après avoir regardé le dernier module d'AE Hero**
- Le repo doit contenir :
  - un **README** (objectif, architecture, comment relancer le projet)
  - tes **tests dbt** et ta **CI** qui passent
  - un **dashboard** fonctionnel, publié avec la documentation
  - une courte section sur tes **choix de modélisation** et leurs compromis

Les critères d'évaluation complets sont dans la formation.

## Avant de rendre un repo public

Passe par `PRE_PUBLISH_CHECKLIST.md`. En résumé :

- [ ] Aucun secret, jeton ou fichier `profiles.yml`
- [ ] Aucun fichier de données ni fichier `.duckdb` commité
- [ ] README complet, CI verte, GitHub Pages activé
- [ ] Aucun contenu réservé aux goodies de la formation

## Problèmes fréquents

| Symptôme | Piste |
|---|---|
| `Could not find profile named ...` | Tu n'as pas créé `real_estate_analysis/profiles.yml`, ou le nom du profil ne correspond pas à `dbt_project.yml`. |
| `Catalog Error: Table with name dvf does not exist` | Le hook de chargement n'a pas tourné : lance `dbt build` depuis `real_estate_analysis/`, ou `dbt run-operation load_dvf`. |
| `... is not in the catalog, but it exists in the spatial extension` | Ajoute `spatial` dans `extensions` de ton `profiles.yml`. |
| `Could not set lock on file ... dev.duckdb` | Ferme les autres connexions à la base (UI DuckDB, extension VS Code), puis relance. |
| `dbt: command not found` | L'environnement virtuel n'est pas activé. |
| Le téléchargement DVF échoue | Vérifie ta connexion et l'URL `files.data.gouv.fr/geo-dvf/latest/csv/`, puis relance avec `--vars '{dvf_reload: true}'`. |
| La CI échoue mais `dbt build` passe en local | Compare les versions de Python et des paquets avec `requirements.txt`. |
| La doc n'apparaît pas | Vérifie que GitHub Pages est configuré sur **GitHub Actions** et que le workflow est vert. |

Une question ? Pose-la sur la communauté AE Hero, avec le message d'erreur complet.

## Source des données et licence

Les données DVF sont publiées par la DGFiP et mises à disposition sur [data.gouv.fr](https://www.data.gouv.fr) sous **Licence Ouverte**. Les contours IRIS sont produits par l'IGN et l'INSEE. Cite les sources si tu publies des résultats.