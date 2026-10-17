#!/usr/bin/env python3
"""Exporte les tables d'une base DuckDB en fichiers Parquet pour l'explorateur web.

Les fichiers sont servis par GitHub Pages en même origine que le site MkDocs
(donc pas de problème de CORS) et lus à la demande par DuckDB-WASM.

Un manifest.json est (ré)écrit dans le dossier de sortie, avec une entrée par
environnement : on peut appeler le script plusieurs fois (prod puis preprod).

Usage :
    python export_parquet.py --env prod --db prod.duckdb --out site/data
    python export_parquet.py --env prod --db prod.duckdb --out site/data \
        --schemas main_marts --max-table-mb 100
"""

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

import duckdb

SYSTEM_SCHEMAS = ("information_schema", "pg_catalog")


def safe(name: str) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_") or "t"


def quote(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def copy_to_parquet(con, query: str, target: Path) -> float:
    target.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY ({query}) TO '{target.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)")
    return target.stat().st_size / 1024 / 1024


def export_env(env: str, db_path: Path, out_dir: Path, args) -> list[dict]:
    con = duckdb.connect(str(db_path), read_only=True)
    try:  # colonnes GEOMETRY éventuelles
        con.execute("INSTALL spatial; LOAD spatial;")
    except Exception:
        pass

    wanted_schemas = {s.strip() for s in args.schemas.split(",") if s.strip()}
    excludes = [p.strip() for p in args.exclude.split(",") if p.strip()]

    candidates = [
        (schema, table)
        for schema, table in con.execute(
            "SELECT table_schema, table_name FROM information_schema.tables ORDER BY 1, 2"
        ).fetchall()
        if schema not in SYSTEM_SCHEMAS
        and (not wanted_schemas or schema in wanted_schemas)
        and not any(
            fnmatch.fnmatch(name, pat)
            for pat in excludes
            for name in (table, schema, f"{schema}.{table}")
        )
    ]

    name_counts: dict[str, int] = {}
    for _, table in candidates:
        name_counts[table] = name_counts.get(table, 0) + 1

    tables = []
    total_mb = 0.0
    for schema, table in candidates:
        view = table if name_counts[table] == 1 else f"{schema}__{table}"
        rel = f"{quote(schema)}.{quote(table)}"
        file_rel = f"{env}/{safe(view)}.parquet"
        target = out_dir / file_rel
        try:
            rows_total = con.execute(f"SELECT count(*) FROM {rel}").fetchone()[0]
            size = copy_to_parquet(con, f"SELECT * FROM {rel}", target)
            sampled = False
            if size > args.max_table_mb:
                size = copy_to_parquet(
                    con, f"SELECT * FROM {rel} USING SAMPLE {args.sample_rows} ROWS", target
                )
                sampled = True
            if size > args.max_table_mb:
                target.unlink(missing_ok=True)
                print(f"::warning::{env}.{view} ignorée : {size:.0f} Mo après échantillonnage")
                continue
        except Exception as exc:  # une table cassée ne doit pas bloquer les autres
            target.unlink(missing_ok=True)
            print(f"::warning::{env}.{view} ignorée : {exc}")
            continue

        total_mb += size
        tables.append(
            {
                "view": safe(view),
                "source": f"{schema}.{table}",
                "file": file_rel,
                "rows": rows_total,
                "sampled": sampled,
                "size_mb": round(size, 2),
            }
        )
        flag = " (échantillon)" if sampled else ""
        print(f"{env}: {schema}.{table} -> {file_rel} {size:.1f} Mo{flag}")

    print(f"{env}: {len(tables)} table(s), {total_mb:.1f} Mo au total")
    if total_mb > args.max_total_mb:
        print(f"::warning::{env} : {total_mb:.0f} Mo exportés (budget {args.max_total_mb} Mo)")
    con.close()
    return tables


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", required=True, help="Nom de l'environnement (prod, preprod)")
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--schemas", default="", help="Schémas à exporter, séparés par des virgules (défaut : tous)")
    parser.add_argument(
        "--exclude",
        default="raw*,_*",
        help="Motifs (glob) à ignorer, testés sur le nom de table, le schéma et schema.table",
    )
    parser.add_argument("--max-table-mb", type=float, default=100.0)
    parser.add_argument("--sample-rows", type=int, default=200_000)
    parser.add_argument("--max-total-mb", type=float, default=400.0)
    args = parser.parse_args()

    if not args.db.exists():
        print(f"Base introuvable : {args.db}", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    tables = export_env(args.env, args.db, args.out, args)

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest.setdefault("environments", {})[args.env] = {"tables": tables}
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())