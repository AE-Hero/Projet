# Explorateur SQL

Interrogez directement la base **depuis votre navigateur**, sans rien installer :
DuckDB s'exécute sur votre machine (WebAssembly) et lit les données publiées
avec ce site.

<div id="explorer" data-base="data/">
<p id="dbx-status" class="dbx-status">Chargement…</p>
<div class="dbx-layout">
<aside>
<h4>Tables</h4>
<div id="dbx-tables"></div>
</aside>
<section>
<textarea id="dbx-sql" spellcheck="false" rows="8"></textarea>
<div class="dbx-actions">
<button id="dbx-run" class="md-button md-button--primary" disabled>Exécuter (Ctrl+Entrée)</button>
<span id="dbx-info"></span>
</div>
<div id="dbx-result" class="dbx-result"></div>
</section>
</div>
</div>

## Comment ça marche

- Les tables de l'environnement **__ENV__** sont disponibles sous `__ENV__.<table>`.
  Cliquez sur une table pour insérer une requête d'exemple.
- Les fichiers sont lus à la demande : seules les parties nécessaires à votre requête sont téléchargées.
- Les résultats sont limités à 1 000 lignes à l'écran. Ajoutez des `LIMIT` et des agrégats.

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