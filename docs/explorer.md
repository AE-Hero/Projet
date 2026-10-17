---
hide:
  - navigation
  - toc
---

# Explorateur SQL

<div id="explorer" data-base="data/"></div>

## Comment ça marche

- DuckDB s'exécute **dans votre navigateur** (WebAssembly) : rien à installer.
- Le panneau de gauche liste les tables de l'environnement **__ENV__**, sous `__ENV__.<table>`.
  Cliquez sur ▸ pour voir les colonnes, sur un nom pour l'insérer dans la requête,
  sur ▶ pour un aperçu des 100 premières lignes.
- Plusieurs onglets de requêtes sont disponibles (double-clic pour renommer). Ils sont
  conservés dans votre navigateur.
- Sélectionnez une partie de la requête puis Ctrl+Entrée pour n'exécuter que la sélection.
- Les fichiers sont lus à la demande : seules les parties nécessaires à votre requête sont téléchargées.
- Les résultats sont limités à 1 000 lignes à l'écran. Le bouton **CSV** exporte le résultat complet.

!!! note "Échantillons"
    Les tables trop volumineuses sont publiées sous forme d'**échantillon aléatoire**
    (indiqué à côté de la table). Les comptages et agrégats sur ces tables sont
    donc approximatifs. Pour travailler sur la donnée complète, téléchargez la base
    (voir ci-dessous).

!!! warning "Navigateur"
    Le premier chargement télécharge DuckDB (quelques Mo). Si l'explorateur ne
    démarre pas, essayez un navigateur récent (Chrome, Firefox, Safari, Edge).

## Travailler sur la base complète

La base est publiée dans une release du dépôt :

- Base __ENV__ : `https://github.com/__REPO__/releases/download/db-__ENV__/__ENV__.duckdb`

```bash
curl -L -o __ENV__.duckdb \
  https://github.com/__REPO__/releases/download/db-__ENV__/__ENV__.duckdb

duckdb -ui __ENV__.duckdb    # interface web de DuckDB
```

!!! tip "Version de DuckDB"
    Utilisez une version de DuckDB au moins égale à celle indiquée dans
    `requirements.txt`, sinon le fichier peut être refusé.