# Projet fil rouge AE Hero : DVF

Tu pars de la donnée publique **DVF** (Demandes de valeurs foncières, transactions immobilières), enrichie des **contours IRIS** de l'IGN et de l'INSEE (le découpage en quartiers du département du Nord, le 59), et tu construis ta propre modélisation avec dbt et DuckDB, de la donnée brute jusqu'au dashboard, avec une chaîne de CI/CD complète comme en entreprise.

> Il n'y a pas de solution unique. Tout le monde part de la même source, mais **ta modélisation est la tienne**.

**Sommaire** : [Ton scénario](#ton-scénario) · [Ce que tu vas construire](#ce-que-tu-vas-construire) · [Démarrage rapide](#démarrage-rapide) · [Comprendre la donnée](#comprendre-la-donnée) · [Chargement des données](#chargement-des-données) · [Structure](#structure-du-projet) · [Comment travailler](#comment-travailler) · [CI/CD](#cicd--ce-qui-tourne-tout-seul) · [Le site](#le-site) · [Qualité](#qualité-des-données) · [Rendu](#ce-que-tu-dois-rendre) · [Dépannage](#problèmes-fréquents)

## Ton scénario

**Tu es promoteur immobilier ou marchand de biens**, dans le Nord (59). Tu dois décider où investir, et tu n'as qu'une source de vérité : les transactions passées. Ton dashboard est l'outil que tu présenterais à ton comité d'investissement.

Choisis ton rôle (ou fais les deux) :

| | 🏗️ Promoteur | 🔨 Marchand de biens |
|---|---|---|
| **Ce que tu fais** | Tu achètes un terrain, tu construis, tu vends des logements neufs | Tu achètes un bien ancien, tu le rénoves, tu le revends |
| **Ce qui t'intéresse dans DVF** | Les ventes de terrains à bâtir et les ventes en l'état futur d'achèvement (neuf) | Les ventes de maisons et d'appartements anciens, et leurs reventes |
| **Ta marge apparente** | Prix du neuf au m² − prix du foncier | Prix de revente − prix d'achat, sur un même bien |

Les IRIS te servent à raisonner **par quartier** plutôt que par commune : un même marché peut varier fortement d'un quartier de Lille à l'autre.

### Les KPI

Légende : 🏗️ promoteur · 🔨 marchand de biens · 🏗️🔨 les deux. Tous se calculent **par IRIS et par an** ; les formules sont des points de départ, à toi de les préciser (filtres, seuils, grain).

| KPI | Pour qui | Formule | Colonnes DVF utilisées |
|---|---|---|---|
| **Prix médian du foncier** (€/m² de terrain) | 🏗️ | médiane de `valeur_fonciere / surface_terrain`, ventes de terrains à bâtir | `nature_mutation`, `valeur_fonciere`, `surface_terrain` |
| **Prix médian du neuf** (€/m² bâti) | 🏗️ | médiane de `valeur_fonciere / surface_reelle_bati`, ventes en l'état futur d'achèvement | `nature_mutation`, `valeur_fonciere`, `surface_reelle_bati` |
| **Marge apparente promoteur** (%) | 🏗️ | (prix du neuf − prix du foncier) / prix du neuf | les deux KPI ci-dessus |
| **Part de terrains à bâtir** (%) | 🏗️ | mutations de terrains à bâtir / mutations totales | `id_mutation`, `nature_mutation` |
| **Prix médian de l'ancien** (€/m² bâti) | 🔨 | médiane de `valeur_fonciere / surface_reelle_bati`, ventes de maisons et d'appartements | `type_local`, `valeur_fonciere`, `surface_reelle_bati` |
| **Plus-value brute apparente** (%) | 🔨 | (prix de revente − prix d'achat) / prix d'achat, sur un même bien | `id_parcelle`, `date_mutation`, `valeur_fonciere` |
| **Délai de revente** (mois) | 🔨 | médiane de (date de revente − date d'achat) | `id_parcelle`, `date_mutation` |
| **Taux de reventes rapides** (%) | 🔨 | reventes à moins de 24 mois / ventes de l'ancien | `id_parcelle`, `date_mutation` |
| **Décote de quartier** (%) | 🔨 | prix médian de l'IRIS / prix médian de sa commune − 1 | `code_commune` + prix médian |
| **Volume de ventes** | 🏗️🔨 | nombre de `id_mutation` distincts (neuf pour 🏗️, ancien pour 🔨) | `id_mutation`, `nature_mutation` |
| **Évolution annuelle** (%) | 🏗️🔨 | (médiane de l'année N − médiane de N−1) / médiane de N−1 | `date_mutation` + prix médian |

<details>
<summary>Pièges par KPI</summary>

- **Médiane, pas moyenne** : les ventes aberrantes et multi-biens faussent une moyenne. Impose un nombre minimum de ventes par IRIS, sinon la médiane n'a pas de sens.
- **Foncier vs neuf** : le prix du foncier est au m² de **terrain**, celui du neuf au m² **bâti**. Le calcul de marge compare deux unités différentes : c'est une approximation grossière, pas une marge d'opération. La constructibilité réelle (PLU) n'est pas dans DVF.
- **Neuf** : une vente en bloc ou multi-lots fausse le ratio, et la surface bâtie peut être manquante.
- **Volume** : compte des `id_mutation` distincts, pas des lignes (voir [Le grain](#le-grain--ce-nest-pas-une-ligne-par-vente)).
- **Revente** : une parcelle peut regrouper plusieurs biens (immeuble, lotissement). Une revente n'est fiable que si tu identifies bien **le même bien**.
- **Période courte** : avec `dvf_years` à 2022-2023, tu ne vois que des reventes de moins de 2 ans, ce qui biaise le délai et la plus-value vers les reventes rapides. Étends les années si tu veux étudier la revente.
- **Décote** : les IRIS de type `Z` couvrent toute la commune, donc aucune décote n'est possible pour eux.
- **Marge brute** : ni les coûts de travaux, ni les frais, ni la fiscalité ne sont dans DVF.

</details>

<details>
<summary>Exemples de questions métier (à adapter, ce ne sont pas des consignes)</summary>

**Promoteur**

- Dans quels IRIS se vendent des terrains à bâtir, et à quel prix au m² de terrain ?
- Comment le prix du neuf au m² se compare-t-il à celui de l'ancien dans le même quartier ?
- Quels quartiers combinent un marché actif (volume de ventes) et un écart de prix favorable entre foncier et neuf ?

**Marchand de biens**

- Quels quartiers ont un marché de l'ancien liquide (beaucoup de transactions) et un prix au m² qui progresse ?
- Quels biens ont été revendus deux fois en peu de temps, et avec quelle plus-value apparente ?
- Où trouve-t-on les écarts de prix les plus marqués entre IRIS voisins ?

**Dans tous les cas** : dis ce que ta donnée ne permet pas de conclure. Les coûts de travaux, la constructibilité réelle d'un terrain ou l'état d'un bien ne sont pas dans DVF : ta marge est une marge **apparente**, pas un résultat d'opération.

</details>

<details>
<summary>Pour aller plus loin : sources complémentaires (optionnel)</summary>

Ces sources ne sont pas chargées dans le projet. Elles permettraient d'affiner l'analyse, à toi de décider si elles valent l'effort et le temps de build en plus :

- **Permis de construire** (base Sitadel, ministère de la Transition écologique) : pour voir l'offre neuve en cours de développement par commune.
- **Urbanisme et PLU** (Géoportail de l'urbanisme) : pour savoir ce qui est réellement constructible. Plus lourd à exploiter.
- **DPE** (ADEME) : pour repérer les logements énergivores, donc des opportunités de rénovation.
- **Revenus par IRIS** (Filosofi, INSEE) : pour croiser prix et pouvoir d'achat du quartier.

Vérifie le périmètre, le format et la licence de chaque source avant de l'intégrer.

</details>

## Ce que tu vas construire

- Une chaîne de transformation dbt (staging → intermediate → marts) sur DuckDB
- Des tests de qualité de données et une CI qui passe (lint SQL, `dbt build`, revue de la structure du projet)
- Un déploiement automatique en **preprod** (à chaque push sur `main`) puis en **prod** (à chaque version)
- Un suivi quotidien de la qualité des données avec **Elementary**
- Un **site web** publié sur GitHub Pages : documentation, dashboards, documentation dbt, rapport de qualité et explorateur SQL dans le navigateur
- Un dashboard qui répond à des questions métier

Les consignes, les questions métier et les critères d'évaluation sont dans la formation.

## Prérequis

- [**uv**](https://docs.astral.sh/uv/getting-started/installation/) (gestionnaire d'environnements et de paquets Python) : il peut aussi installer Python pour toi
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

---

### 2. Crée l'environnement avec uv

**a. Installe uv** (une seule fois, saute cette étape si tu l'as déjà). Choisis ton système :

<details>
<summary>🍎 Mac / Linux</summary>

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Ou avec Homebrew : `brew install uv`. Ferme et rouvre ton terminal, puis vérifie avec `uv --version`.

</details>

<details>
<summary>🪟 Windows</summary>

Dans **PowerShell** :

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Ou avec winget : `winget install --id=astral-sh.uv -e`. Ferme et rouvre ton terminal, puis vérifie avec `uv --version`.

</details>

**b. Crée l'environnement** (identique sur Mac et Windows) :

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
```

`uv venv` crée le dossier `.venv` (et télécharge Python 3.12 s'il manque). `requirements.txt` installe dbt, DuckDB, SQLFluff et la CLI Elementary.

**c. Active l'environnement** (à refaire dans chaque nouveau terminal) :

<details>
<summary>🍎 Mac / Linux</summary>

```bash
source .venv/bin/activate
dbt --version
```

</details>

<details>
<summary>🪟 Windows (PowerShell)</summary>

```powershell
.venv\Scripts\Activate.ps1
dbt --version
```

Si PowerShell refuse d'exécuter le script (erreur « l'exécution de scripts est désactivée »), autorise-les pour ton utilisateur, puis recommence :

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Avec **Git Bash** : `source .venv/Scripts/activate`.

</details>

**Sans activer :** préfixe simplement chaque commande par `uv run` (par exemple `uv run dbt --version`). Cela fonctionne pareil sur Mac et Windows.

<details>
<summary>Je préfère pip (sans uv)</summary>

Avec Python 3.10 ou plus récent déjà installé :

**🍎 Mac / Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

**🪟 Windows (PowerShell)**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

</details>

<details>
<summary>Dépendances du site (MkDocs)</summary>

Elles sont dans `docs-requirements.txt` : tu n'en as besoin que pour prévisualiser le site en local.

```bash
uv pip install -r docs-requirements.txt
uv run mkdocs serve
```

</details>

---

### 3. Lance dbt

Toutes les commandes dbt se lancent depuis `real_estate_analysis/` :

```bash
cd real_estate_analysis
dbt deps
dbt build
```

`dbt build` charge aussi le seed IRIS. Au premier lancement, la base `dev.duckdb` est **créée** et les données DVF y sont téléchargées automatiquement (`main.dvf`, `main.iris_59`). Tant que ce premier build n'a pas tourné, le fichier n'existe pas.

---

### 4. Explore la donnée brute

> **Prérequis : avoir lancé `dbt build` (étape 3) au moins une fois.** C'est lui qui crée `dev.duckdb` et charge les tables. Si tu ouvres l'UI avant, DuckDB crée un fichier **vide** : tu n'y verras aucune table.

Avant de modéliser, regarde ce que tu as. Ouvre `dev.duckdb` avec l'**interface web de DuckDB** (DuckDB UI) : elle s'ouvre dans ton navigateur, avec un éditeur SQL, l'explorateur de tables et les résultats sous forme de tableaux.

<details>
<summary>🍎 Mac / Linux</summary>

```bash
brew install duckdb        # une seule fois (ou voir duckdb.org/install)
duckdb -ui real_estate_analysis/dev.duckdb
```

</details>

<details>
<summary>🪟 Windows</summary>

```powershell
winget install DuckDB.cli  # une seule fois, puis rouvre le terminal
duckdb -ui real_estate_analysis\dev.duckdb
```

</details>

L'interface s'ouvre sur `http://localhost:4213`. Au premier lancement, DuckDB télécharge l'extension `ui` : il faut une connexion internet. Si le navigateur ne s'ouvre pas, copie l'adresse dans la barre d'URL. Tu peux aussi la démarrer depuis un CLI DuckDB déjà ouvert avec `CALL start_ui();`.

> ⚠️ **Ferme l'UI (Ctrl+C dans le terminal) avant de relancer `dbt build`** : tant qu'elle est ouverte, elle verrouille `dev.duckdb` (voir [Dépannage](#problèmes-fréquents)).

Colle ces requêtes dans l'éditeur de l'UI :

```sql
-- Volume et période couverte
select count(*) as nb_lignes,
       count(distinct id_mutation) as nb_mutations,
       min(date_mutation) as premiere_date,
       max(date_mutation) as derniere_date
from main.dvf;

-- Répartition par nature de mutation et type de local
select nature_mutation, type_local, count(*) as nb_lignes
from main.dvf
group by all
order by nb_lignes desc;
```

---

### 5. Les cibles dbt

Le projet dbt se trouve dans `real_estate_analysis/`. Son `profiles.yml` est **versionné** : il ne contient aucun secret (des bases DuckDB locales) et la CI l'utilise. Il définit quatre cibles, une par environnement :

| Cible | Base | Utilisée pour |
|---|---|---|
| `dev` | `dev.duckdb` | ton travail en local (cible par défaut) |
| `ci` | `ci.duckdb` | la CI sur les pull requests |
| `preprod` | `preprod.duckdb` | le déploiement sur `main` |
| `prod` | `prod.duckdb` | le déploiement par version |

La cible se choisit avec la variable `DBT_TARGET` (ou `--target`). Un second profil, `elementary`, sert uniquement à générer le rapport de qualité.

---

## Comprendre la donnée

Deux sources alimentent le projet : **DVF** (les transactions) et les **contours IRIS** (les quartiers). Comprends chacune avant de modéliser.

### 1. DVF

DVF recense les mutations à titre onéreux (ventes, ventes en l'état futur d'achèvement, adjudications, échanges, expropriations…) des cinq dernières années, publiées par la DGFiP. Le fichier utilisé ici est la version géolocalisée (`geo-dvf`) : chaque ligne porte déjà une latitude et une longitude quand le géocodage a réussi.

#### Le grain : ce n'est pas une ligne par vente

C'est le point qui piège le plus. Une **mutation** (`id_mutation`) est une transaction. Elle peut contenir plusieurs dispositions, plusieurs parcelles, plusieurs locaux (maison, appartement, dépendance…) et plusieurs natures de culture.

Le fichier a donc **une ligne par combinaison local / parcelle**, et `valeur_fonciere` est **répétée sur chaque ligne** de la mutation.

> ⚠️ `sum(valeur_fonciere)` sur la table brute **compte plusieurs fois** le même prix. Compter les lignes ne compte pas les ventes : compte des `id_mutation` distincts.

Choisir ton grain (une ligne par mutation ? par local ? par parcelle ?) est la décision de modélisation centrale du projet. Documente-la dans ta section « choix de modélisation ».

<details>
<summary>Colonnes à connaître</summary>

| Colonne | Contenu | Attention |
|---|---|---|
| `id_mutation` | Identifiant de la transaction | Clé du regroupement, pas unique par ligne |
| `date_mutation` | Date de l'acte | À typer en `date` |
| `nature_mutation` | Vente, Vente en l'état futur d'achèvement, Adjudication, Échange… | Toutes ne sont pas des ventes « classiques » |
| `valeur_fonciere` | Prix de la mutation entière | Répété par ligne ; parfois vide |
| `type_local` | Maison, Appartement, Dépendance, Local industriel et commercial ou assimilé | Vide pour les terrains non bâtis |
| `surface_reelle_bati` | Surface bâtie du local | Vide ou 0 pour les dépendances et terrains |
| `lot1_surface_carrez` … `lot5_surface_carrez` | Surfaces Carrez par lot | Surtout renseignées pour les appartements |
| `nombre_pieces_principales` | Nombre de pièces | 0 possible hors logement |
| `surface_terrain` | Surface de la parcelle ou de la nature de culture | Pas la surface du logement |
| `code_commune`, `code_postal`, `code_departement` | Localisation administrative | Codes en texte (garde les zéros initiaux) |
| `id_parcelle` | Référence cadastrale | Granularité la plus fine |
| `longitude`, `latitude` | Coordonnées géocodées | Manquantes pour une part des lignes |

La liste complète est dans le fichier téléchargé : fais un `describe main.dvf` pour voir les types réels.

</details>

<details>
<summary>Pièges de qualité à anticiper</summary>

- **Prix aberrants** : des mutations à quelques euros (ventes symboliques, cessions entre proches) et à l'inverse des montants très élevés (ventes en bloc d'immeubles ou de portefeuilles). Décide d'une règle de filtrage et assume-la.
- **Ventes multi-biens** : un seul prix pour une maison, un garage et un terrain. Le prix au m² d'une telle mutation est difficile à interpréter.
- **Valeurs manquantes** : prix, surface ou coordonnées vides. Mesure leur taux plutôt que de les supposer absents.
- **Surface à 0** : à traiter avant toute division, sinon le prix au m² explose ou plante.
- **Doublons apparents** : des lignes proches peuvent être légitimes (plusieurs locaux). Distingue un vrai doublon d'une ligne supplémentaire du même acte.
- **Couverture** : DVF ne couvre pas l'Alsace-Moselle (57, 67, 68) ni Mayotte. Les années récentes sont mises à jour par vagues : la dernière période peut être incomplète.
- **Codes géographiques** : les communes fusionnent (`ancien_code_commune`), et les codes département de Corse sont `2A` / `2B`.

</details>

<details>
<summary>Pistes de tests dbt</summary>

Des idées pour démarrer, adapte-les à ton modèle :

- `not_null` et `unique` sur la clé de ton grain (pas sur `id_mutation` dans le staging brut !)
- `accepted_values` sur `nature_mutation` et `type_local`
- `dbt_utils.accepted_range` sur les prix et les surfaces
- Un test singulier qui vérifie que la somme des prix de ta table finale ne double pas ceux de la source
- `elementary.volume_anomalies` sur le nombre de mutations par mois

</details>

### 2. Les données IRIS

Un **IRIS** (Îlot Regroupé pour l'Information Statistique) est le découpage infra-communal de l'INSEE : un quartier d'environ 2 000 habitants. Les communes de moins de 10 000 habitants sont en général **non découpées** : elles n'ont qu'un seul IRIS, qui couvre toute la commune.

Le **code IRIS** fait 9 caractères : le code commune INSEE (5) suivi de 4 chiffres. Exemple de forme : `59350` (commune) + `0101` (IRIS) → `593500101`.

**Le grain : une ligne par IRIS.** Contrairement à DVF, il n'y a pas de piège de répétition : un IRIS = une ligne = une géométrie (un polygone ou un multipolygone). Le piège vient de la **jointure** avec DVF, voir ci-dessous.

<details>
<summary>Colonnes à connaître (IRIS)</summary>

Les contours IGN fournissent ces champs. Vérifie les noms réels dans ton seed avec `describe main.iris_59` : le seed a pu renommer ou écarter certaines colonnes.

| Colonne | Contenu | Attention |
|---|---|---|
| `code_iris` | Identifiant de l'IRIS (9 caractères) | À garder en **texte** : les zéros initiaux comptent (départements `01` à `09`, mais aussi les `0000`) |
| `nom_iris` | Nom de l'IRIS | Peut être répété d'une commune à l'autre |
| `insee_com` | Code commune INSEE | Clé de rattachement avec `code_commune` de DVF |
| `nom_com` | Nom de la commune | Pour l'affichage, pas pour joindre |
| `typ_iris` | Type : `H` (habitat), `A` (activité), `D` (divers), `Z` (commune non découpée) | Les IRIS `A` et `D` ont peu ou pas d'habitants : à connaître avant d'analyser par habitant |
| géométrie (WKT) | Contour en WGS84 (longitude, latitude) | Stockée en **texte** dans le seed : à convertir avec `st_geomfromtext` |

</details>

<details>
<summary>Pièges de qualité à anticiper (IRIS)</summary>

- **Ordre des coordonnées** : en WKT et dans `st_point`, l'ordre est **longitude puis latitude** (x, y). L'inverser donne zéro correspondance, sans erreur.
- **Transactions sans IRIS** : coordonnées manquantes dans DVF, point hors des contours (bord de mer, géocodage approximatif), ou département absent du seed. Mesure le taux de transactions non rattachées.
- **Points sur une frontière** : avec des contours simplifiés (~10 m), un point proche d'une limite peut tomber dans l'IRIS voisin, voire dans deux IRIS (doublons après jointure). Vérifie que ta jointure ne multiplie pas les lignes DVF.
- **Millésime** : les contours IRIS ont une année de référence et les communes fusionnent. Une transaction ancienne peut porter un code commune qui n'existe plus dans le référentiel.
- **Communes non découpées** : pour un IRIS de type `Z`, « le quartier » est toute la commune. Ne compare pas ces lignes aux IRIS d'une grande ville sans en tenir compte.
- **Géométries invalides** : après simplification, un polygone peut devenir invalide. Teste avec `st_isvalid`.
- **Texte vs géométrie** : la colonne WKT est du texte tant qu'elle n'est pas convertie. Une jointure spatiale dessus ne marche pas et ne lève pas toujours une erreur claire.

</details>

<details>
<summary>Exemple : rattacher une transaction à son IRIS</summary>

Dans l'UI DuckDB (extension `spatial` active dans ton profil), pour vérifier le taux de rattachement avant de modéliser :

```sql
with iris as (
    select code_iris, st_geomfromtext(geometrie_wkt) as geom  -- adapte le nom de colonne
    from main.iris_59
),

mutations as (
    select distinct id_mutation, longitude, latitude
    from main.dvf
    where longitude is not null and latitude is not null
)

select
    count(*) as nb_mutations,
    count(iris.code_iris) as nb_rattachees,
    count(*) - count(iris.code_iris) as nb_sans_iris,
    count(*) - count(distinct m.id_mutation) as lignes_en_double
from mutations as m
left join iris
    on st_within(st_point(m.longitude, m.latitude), iris.geom)
```

`lignes_en_double` doit rester à 0 : sinon, un point tombe dans plusieurs IRIS et ta jointure multiplie les mutations. Cette requête est un point de départ : à toi de choisir comment traiter les cas limites dans ton modèle.

</details>

<details>
<summary>Pistes de tests dbt (IRIS)</summary>

- `unique` et `not_null` sur `code_iris`
- `accepted_values` sur `typ_iris` (`H`, `A`, `D`, `Z`)
- Un test sur la longueur de `code_iris` (9 caractères)
- Un test singulier : aucune mutation n'est dupliquée après la jointure spatiale
- Un seuil d'alerte sur le taux de transactions sans IRIS (par exemple via `dbt_utils.expression_is_true` sur un modèle agrégé)

</details>

## Chargement des données

| Données | Table | Chargement |
|---|---|---|
| DVF | `main.dvf` (source) | Macro `load_dvf` en `on-run-start`, téléchargement depuis `files.data.gouv.fr/geo-dvf` |
| Contours IRIS du 59 | `main.iris_59` (seed) | `dbt seed` / `dbt build`, depuis `seeds/iris_59.csv` |

<details>
<summary>DVF : fonctionnement du chargement et changement de périmètre</summary>

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

> **Plus de départements, plus de temps.** Chaque département et chaque année ajoutent du volume : le téléchargement, le `dbt build` et la CI ralentissent en conséquence. Reste sur le 59 tant que ta modélisation n'est pas stable.

</details>

<details>
<summary>Contours IRIS : ce que contient le seed et ses limites</summary>

`seeds/iris_59.csv` contient les 1 345 IRIS du département 59, extraits des **Contours IRIS** de l'IGN (GeoPackage national, trop lourd pour être commité : 176 Mo).

- Géométries en WGS84, simplifiées à ~10 m et arrondies à 5 décimales (~1 m) : le fichier pèse 1,5 Mo. C'est largement assez précis pour rattacher une transaction à un IRIS.
- Elles sont stockées en texte (WKT) et converties en géométrie dans `stg_geospacial_coordinates` avec `st_geomfromtext`.
- Le rattachement transaction → IRIS se fait par jointure spatiale sur `longitude` / `latitude` : les lignes sans coordonnées ne peuvent pas être rattachées. Mesure ce taux et décide quoi en faire.
- **Le seed ne couvre que le 59.** Si tu ajoutes des départements à `dvf_departements`, il faut régénérer le seed à partir du GeoPackage.

</details>

## Structure du projet

<details>
<summary>Arborescence du repo</summary>

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

</details>

## Comment travailler

1. Crée une **branche** par étape ou par fonctionnalité.
2. Ouvre une **Pull Request** vers `main` : la CI se lance automatiquement et commente la PR.
3. Fusionne seulement quand la CI est verte.
4. Garde des PR petites (une idée par PR).

Un ordre de travail qui fonctionne bien : staging → premier mart simple → tests → CI verte → dashboard → enrichissements (IRIS, anomalies Elementary). Mieux vaut un projet simple qui se déploie qu'un modèle ambitieux qui ne passe pas la CI.

## CI/CD : ce qui tourne tout seul

Tu n'as rien à lancer : les workflows (dossier `.github/workflows/`, onglet **Actions** sur GitHub) se déclenchent seuls.

<details>
<summary>Que se passe-t-il, et quand ?</summary>

| Quand | Ce qui se passe |
|---|---|
| **Pull request** | Lint **SQLFluff**, `dbt build` avec tests sur la cible `ci`, revue de la structure du projet avec **dbt-project-evaluator** (les écarts font échouer la CI). Les résultats sont commentés dans la PR. |
| **Push sur `main`** | Déploiement en **preprod** : `dbt build` sur `preprod`, la base `preprod.duckdb` et les dashboards sont publiés dans la release `db-preprod`, puis le site est reconstruit. |
| **Version (tag `v*`)** | Déploiement en **prod**, même principe avec la release `db-prod`. |
| **Tous les jours** | « dbt run daily » : `dbt build` sur preprod (et prod), tests et **Elementary** inclus, puis republication de la base. |
| **Changement de la doc ou du site** | Reconstruction et publication du site sur GitHub Pages. |

</details>

### Premiers pas sur GitHub

Dans ton repo, **avant le premier push sur `main`** :

1. **Settings → Pages** : choisis **Source : GitHub Actions**.
2. **Settings → Actions → General** : active les workflows, et dans *Workflow permissions* choisis **Read and write permissions** (les déploiements publient les bases dans des releases).
3. Si tu as créé ton repo depuis un template, ouvre l'onglet **Actions** et active les workflows planifiés (« dbt run daily »).

Les workflows quotidiens téléchargent la base d'une release existante : ils échouent tant que le premier déploiement n'a pas eu lieu.

### Publier en production

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Le site

Une fois publié, ton site est à `https://<ton-pseudo>.github.io/<ton-repo>/`, avec **deux versions** :

- `/preprod/` : reflète la branche `main`
- `/prod/` : reflète la dernière version publiée (vide tant que tu n'as pas poussé de tag `v*`)

<details>
<summary>Pages du site</summary>

| Page | Contenu |
|---|---|
| **Accueil** | Présentation du projet, stack, organisation, workflow |
| **Dashboards** | Tes dashboards (dbt Charts), intégrés dans la page |
| **Documentation dbt** | Lineage, description des modèles et colonnes (`dbt docs`) |
| **Qualité des données** | Rapport **Elementary** : résultats des tests, historique des exécutions |
| **Explorateur SQL** | Requêtes SQL dans le navigateur (DuckDB-WASM) sur les tables publiées en Parquet |

</details>

<details>
<summary>Personnaliser et prévisualiser le site</summary>

Pour personnaliser les pages, modifie `docs/` (texte, pages) et `docs/stylesheets/` (couleurs et mise en page), puis pousse sur `main`.

Pour prévisualiser en local :

```bash
uv pip install -r docs-requirements.txt
uv run mkdocs serve
```

Les pages Dashboards, Documentation dbt et Qualité des données n'affichent leur contenu que sur le site publié, car il est généré par le déploiement.

**L'explorateur SQL** lit les tables en Parquet publiées avec le site. Les tables volumineuses sont **échantillonnées** : ne tire pas de conclusion chiffrée d'une requête dans l'explorateur. Pour travailler sur la base complète, télécharge `preprod.duckdb` ou `prod.duckdb` depuis les releases `db-preprod` / `db-prod` et ouvre-la avec DuckDB.

</details>

## Qualité des données

- **Tests dbt** : à écrire dans tes `schema.yml` et dans `tests/`. Ils tournent à chaque `dbt build`, en CI et au quotidien.
- **dbt-project-evaluator** : vérifie les bonnes pratiques de structure (nommage, dépendances, documentation). En CI, ses écarts font échouer le build.
- **Elementary** : enregistre dans la base les résultats de chaque exécution (schéma `main_elementary`). Le rapport est sur la page *Qualité des données*. Il se remplit après la première exécution complète avec tests. Tu peux y ajouter des tests de détection d'anomalies (`elementary.volume_anomalies`, `elementary.schema_changes`, …).

Voir aussi [Pièges de qualité à anticiper](#comprendre-la-donnée) pour les contrôles propres à DVF.

## Ce que tu dois rendre

- Le lien vers ton **repo public** : à communiquer sur la **plateforme AE Hero** pour que les autres formés puissent regarder ton projet et t'aider à le rendre meilleur si besoin
- Date limite conseillée: **4 semaines après avoir regardé le dernier module d'AE Hero**
- Le repo doit contenir :
  - un **README** (objectif, architecture, comment lancer le projet)
  - tes **tests dbt** et ta **CI** qui passent
  - un / plusieurs **dashboard(s)** fonctionnel(s), publié(s) avec le site, qui répond aux questions de **ton rôle** (promoteur ou marchand de biens)
  - une courte section sur tes **choix de modélisation** et leurs compromis (grain choisi, traitement des prix aberrants et des ventes multi-biens, gestion des coordonnées manquantes)

<details>
<summary>Avant de rendre un repo public (checklist)</summary>

Passe par `PRE_PUBLISH_CHECKLIST.md`. En résumé :

- [ ] Aucun secret ni jeton dans le repo (le `profiles.yml` fourni n'en contient pas)
- [ ] Aucun fichier de données ni fichier `.duckdb` commité
- [ ] README complet, CI verte, GitHub Pages activé, site `/preprod/` en ligne
- [ ] Aucun contenu réservé aux goodies de la formation

</details>

## Problèmes fréquents

Clique sur la catégorie qui correspond à ton problème.

<details>
<summary>Installation et exécution locale</summary>

| Symptôme | Piste |
|---|---|
| `dbt: command not found` ou `edr: command not found` | L'environnement n'est pas activé : `source .venv/bin/activate`, ou préfixe la commande par `uv run`. Vérifie aussi que `uv pip install -r requirements.txt` a bien été lancé. |
| `Could not find profile named 'real_estate_analysis'` | Tu lances dbt hors de `real_estate_analysis/`, ou le nom du profil ne correspond pas à `dbt_project.yml`. |
| `Could not find profile named 'elementary'` | Le profil `elementary` manque dans `profiles.yml` : il est nécessaire pour générer le rapport de qualité. |
| `Could not set lock on file ... dev.duckdb` | Ferme les autres connexions à la base (UI ou CLI DuckDB : Ctrl+C dans le terminal où tourne `duckdb -ui`, extension VS Code), puis relance. |
| `... is not in the catalog, but it exists in the spatial extension` | Ajoute `spatial` dans `extensions` du profil de ta cible. |

</details>

<details>
<summary>Données DVF et résultats incohérents</summary>

| Symptôme | Piste |
|---|---|
| L'UI DuckDB s'ouvre mais je ne vois aucune table | Le premier `dbt build` n'a pas encore tourné (ou tu as ouvert un autre fichier que `real_estate_analysis/dev.duckdb`). Ferme l'UI, lance `dbt build` depuis `real_estate_analysis/`, puis rouvre l'UI. Supprime au besoin un `dev.duckdb` vide créé au mauvais endroit. |
| `Catalog Error: Table with name dvf does not exist` | Le hook de chargement n'a pas tourné : lance `dbt build` depuis `real_estate_analysis/`, ou `dbt run-operation load_dvf`. |
| Le téléchargement DVF échoue | Vérifie ta connexion et l'URL `files.data.gouv.fr/geo-dvf/latest/csv/`, puis relance avec `--vars '{dvf_reload: true}'`. |
| Mes totaux de prix sont beaucoup trop élevés | Tu additionnes `valeur_fonciere` sur des lignes de la même mutation : voir [Le grain](#le-grain--ce-nest-pas-une-ligne-par-vente). |
| Le prix au m² est infini, nul ou absurde | Surface à 0 ou vide, ou vente multi-biens : filtre ou traite ces cas avant la division. |
| Peu de transactions rattachées à un IRIS | Coordonnées manquantes, ou département hors du seed (qui ne couvre que le 59). |

</details>

<details>
<summary>CI et déploiement</summary>

| Symptôme | Piste |
|---|---|
| La CI échoue mais `dbt build` passe en local | Compare les versions de Python et des paquets avec `requirements.txt`. |
| La CI SQLFluff échoue | Lance `sqlfluff fix` sur le fichier indiqué, relis la différence, puis recommite. |
| La CI échoue sur dbt-project-evaluator | Lis la liste des écarts dans le commentaire de la PR : chaque ligne dit quel modèle corriger et pourquoi. |
| Le workflow « dbt run daily » échoue au téléchargement | La release `db-preprod` (ou `db-prod`) n'existe pas encore : fais d'abord un push sur `main` (ou un tag `v*`) et attends la fin du déploiement. |

</details>

<details>
<summary>Site publié</summary>

| Symptôme | Piste |
|---|---|
| Le site n'apparaît pas | Vérifie que GitHub Pages est configuré sur **GitHub Actions** et que le workflow « Deploy site » est vert. |
| `/prod/` est vide | Normal tant qu'aucun tag `v*` n'a été poussé et que le déploiement prod n'a pas fini. |
| L'explorateur affiche « Aucune donnée publiée » | Le déploiement n'a pas encore publié les tables : regarde le log *Build one site per environment* du workflow « Deploy site ». |
| La page *Qualité des données* affiche « Pas encore disponible » | Le rapport n'a pas pu être généré : regarde l'avertissement `rapport Elementary non généré` dans le même log. |

</details>

Une question ? Pose-la sur la communauté AE Hero, avec le message d'erreur complet.

## Source des données et licence

Les données DVF sont publiées par la DGFiP et mises à disposition sur [data.gouv.fr](https://www.data.gouv.fr) sous **Licence Ouverte**. Les contours IRIS sont produits par l'IGN et l'INSEE. Cite les sources si tu publies des résultats.
