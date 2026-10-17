---
hide:
  - toc
---

<div class="hero" markdown>

# Projet fil rouge

**Real Estate Analysis** : un projet dbt complet sur les Demandes de Valeurs Foncières (DVF),
avec la chaîne de CI/CD que vous rencontrerez en entreprise.

[:material-database-search: Explorer les données](explorer.html){ .md-button .md-button--primary }
[:material-chart-bar: Voir les dashboards](charts/index.html){ .md-button }

<span class="env-line">Environnement <span class="env-badge env-__ENV__">__ENV__</span> · voir aussi le site [__OTHER_ENV__](../__OTHER_ENV__/index.html)</span>

</div>

<div class="flow">
  <div class="step"><strong>DVF</strong><span>données ouvertes</span></div>
  <div class="arrow">→</div>
  <div class="step"><strong>dbt</strong><span>staging, intermediate, marts</span></div>
  <div class="arrow">→</div>
  <div class="step"><strong>DuckDB</strong><span>un fichier par environnement</span></div>
  <div class="arrow">→</div>
  <div class="step"><strong>Ce site</strong><span>dashboards, docs, explorateur</span></div>
</div>

<div class="grid cards" markdown>

- :material-chart-bar:{ .lg .middle } **[Dashboards](charts/index.html)**

    Les tableaux de bord construits sur les données du projet.

- :material-file-tree:{ .lg .middle } **[Documentation dbt](dbt-docs/index.html)**

    Modèles, colonnes, tests et lineage.

- :material-database-search:{ .lg .middle } **[Explorateur SQL](explorer.html)**

    Interrogez les données depuis votre navigateur, sans rien installer.

</div>