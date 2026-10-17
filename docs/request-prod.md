# Requêter la prod

La base de prod est construite à chaque **tag de version `v*`**. C'est la
référence : utilisez-la pour vos analyses et pour comparer vos résultats.

La base est publiée dans la release `db-prod`. Remplacez `<org>` et `<repo>`
par ceux du dépôt.

```text
https://github.com/<org>/<repo>/releases/download/db-prod/prod.duckdb
```

=== "Télécharger puis ouvrir (recommandé)"

    ```bash
    curl -L -o prod.duckdb \
      https://github.com/<org>/<repo>/releases/download/db-prod/prod.duckdb

    # Interface web de DuckDB
    duckdb -ui prod.duckdb

    # ou en ligne de commande
    duckdb prod.duckdb
    ```

=== "Attacher à distance"

    ```sql
    INSTALL httpfs;
    LOAD httpfs;
    ATTACH 'https://github.com/<org>/<repo>/releases/download/db-prod/prod.duckdb'
      AS prod (READ_ONLY);
    USE prod;
    ```

    Plus lent qu'un fichier local : à réserver aux requêtes ponctuelles.

=== "Python"

    ```python
    import duckdb

    con = duckdb.connect("prod.duckdb", read_only=True)
    print(con.sql("SHOW ALL TABLES"))
    ```

## Explorer la base

```sql
SHOW ALL TABLES;

SELECT table_schema, table_name
FROM information_schema.tables
ORDER BY 1, 2;
```

## Notes

- La base est **en lecture seule** : vos modifications ne sont pas envoyées au dépôt.
- Le fichier est remplacé à chaque nouvelle version : retéléchargez-le pour
  récupérer les dernières données.
- La structure des tables est décrite dans la [documentation dbt](dbt-docs.md).