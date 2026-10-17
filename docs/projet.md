# Le projet

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