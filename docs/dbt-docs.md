# Documentation dbt

La documentation générée par `dbt docs generate` est publiée avec ce site :
modèles, colonnes, tests, sources et graphe de dépendances (lineage).

[:material-book-open-variant: Ouvrir la documentation dbt](dbt-docs/index.html){ .md-button .md-button--primary }

!!! info "Mise à jour"
    La documentation est reconstruite à chaque déploiement, à partir de la base
    **__ENV__**. Si le lien ne fonctionne pas, aucun déploiement de cet
    environnement n'a encore eu lieu.

## Générer la doc en local

```bash
cd real_estate_analysis
dbt docs generate
dbt docs serve
```