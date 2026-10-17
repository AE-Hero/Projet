# Requêter la preprod

La preprod est reconstruite à **chaque merge sur `main`**. Elle sert à voir
l'effet des dernières modifications avant la prod, mais elle peut changer à tout
moment.

!!! warning "Base instable"
    Pour des résultats reproductibles, utilisez plutôt la [prod](requeter-prod.md).

La base est publiée dans la release `db-preprod`. Remplacez `<org>` et `<repo>`
par ceux du dépôt.

```text
https://github.com/<org>/<repo>/releases/download/db-preprod/preprod.duckdb
```

=== "Télécharger puis ouvrir (recommandé)"

    ```bash
    curl -L -o preprod.duckdb \
      https://github.com/<org>/<repo>/releases/download/db-preprod/preprod.duckdb

    # Interface web de DuckDB
    duckdb -ui preprod.duckdb

    # ou en ligne de commande
    duckdb preprod.duckdb
    ```

=== "Attacher à distance"

    ```sql
    INSTALL httpfs;
    LOAD httpfs;
    ATTACH 'https://github.com/<org>/<repo>/releases/download/db-preprod/preprod.duckdb'
      AS preprod (READ_ONLY);
    USE preprod;
    ```

    Plus lent qu'un fichier local : à réserver aux requêtes ponctuelles.

=== "Python"

    ```python
    import duckdb

    con = duckdb.connect("preprod.duckdb", read_only=True)
    print(con.sql("SHOW ALL TABLES"))
    ```

## Explorer la base

```sql
SHOW ALL TABLES;

SELECT table_schema, table_name
FROM information_schema.tables
ORDER BY 1, 2;
```