# Projet fil rouge : Real Estate Analysis

Bienvenue sur le site du projet fil rouge de la formation AE Hero.

Vous construisez, chapitre après chapitre, un projet dbt complet sur les
**Demandes de Valeurs Foncières (DVF)**, avec une chaîne de CI/CD proche de ce
que vous rencontrerez en entreprise.

!!! info "Environnement : __ENV__"
    Vous êtes sur le site **__ENV__**. Voir aussi le site [__OTHER_ENV__](../__OTHER_ENV__/index.html).

<div class="grid cards" markdown>

-   :material-chart-box: **[Dashboards](dashboards.md)**

    Les tableaux de bord construits sur les données du projet.

-   :material-book-open-variant: **[Documentation dbt](dbt-docs.md)**

    Modèles, colonnes, tests et lineage.

-   :material-database-search: **[Explorateur SQL](explorer.md)**

    Interrogez les données depuis votre navigateur, sans rien installer.

</div>

## Objectif

Modéliser les données DVF avec dbt : vous concevez **votre propre**
modélisation (staging, intermediate, marts), vous la testez et vous la
documentez. Il n'y a pas de correction fournie : l'objectif est de vous laisser
chercher et de comparer vos choix avec la communauté.

## Stack technique

- **dbt** pour la transformation, les tests et la documentation
- **DuckDB** comme base de données (un simple fichier `.duckdb`)
- **SQL** pour la modélisation
- **GitHub Actions** pour la CI/CD

## Organisation du repo

```text
.github/workflows/      # CI et déploiements
real_estate_analysis/   # le projet dbt
docs/                   # ce site (MkDocs)
mkdocs.yml
```

## Environnements

| Environnement | Déclencheur | Base produite |
|---|---|---|
| CI | Pull request | `ci.duckdb` (jetable) |
| Preprod | Push sur `main` | `preprod.duckdb` |
| Prod | Tag de version `v*` | `prod.duckdb` |

## Workflow de contribution

1. Créez une branche et faites vos modifications.
2. Ouvrez une pull request vers `main`.
3. La CI lance trois vérifications, dont les résultats apparaissent dans la PR :
    - **lint SQL** (SQLFluff)
    - **build dbt** : modèles et tests
    - **project evaluator** : respect des bonnes pratiques de structure
4. Corrigez jusqu'à ce que tout soit vert, puis mergez.
5. Le merge déclenche le déploiement en preprod.

!!! tip "Lint en local"
    Avant de pousser, lancez `sqlfluff fix` sur vos fichiers pour corriger
    automatiquement la plupart des erreurs de style.