#!/usr/bin/env python3
"""Résumé Markdown détaillé des résultats de dbt-project-evaluator.

Pour chaque règle en échec, le script :
  - explique la règle et comment la corriger (RULES ci-dessous) ;
  - liste les ressources fautives, en lisant la table fct_* correspondante
    dans la base DuckDB (option --db). Sans --db, seul le résumé est produit.

Usage (depuis real_estate_analysis/) :
    python ../.github/scripts/format-ci-dbt-project-evaluator.py --db ci.duckdb > summary.md
"""

import argparse
import collections
import json
import re
import sys
from pathlib import Path

REPORTED_STATUSES = ("error", "fail", "warn")
MAX_COMMENT_CHARS = 60_000  # un commentaire GitHub est limité à 65 536 caractères
DOCS_URL = "https://dbt-labs.github.io/dbt-project-evaluator/latest/"

# Modèle fct_* -> (titre, explication et correction). Résumé des règles du package :
# en cas de doute, la documentation du package fait foi.
RULES = {
    "fct_missing_primary_key_tests": (
        "Clé primaire non testée",
        "Ces modèles n'ont pas de test d'unicité et de non-nullité sur leur clé primaire. "
        "Ajoutez `unique` et `not_null` (ou un test combiné) sur la colonne clé dans le YAML du modèle.",
    ),
    "fct_model_directories": (
        "Modèle rangé dans le mauvais dossier",
        "Le dossier du modèle ne correspond pas à son type (staging, intermediate, marts) "
        "déduit de son préfixe. Déplacez le fichier ou renommez-le (`stg_`, `int_`, `fct_`/`dim_`).",
    ),
    "fct_source_directories": (
        "Source déclarée au mauvais endroit",
        "Le fichier YAML de cette source n'est pas dans le dossier staging attendu. "
        "Rangez-le dans le dossier staging correspondant à la source.",
    ),
    "fct_sources_without_freshness": (
        "Source sans contrôle de fraîcheur",
        "Ces sources n'ont pas de configuration `freshness`. Ajoutez `loaded_at_field` "
        "et `warn_after` / `error_after` à la source (ou à la table).",
    ),
    "fct_undocumented_sources": (
        "Source non documentée",
        "Ces sources n'ont pas de `description`. Décrivez la source et ses tables dans le YAML.",
    ),
    "fct_undocumented_models": (
        "Modèle non documenté",
        "Ces modèles n'ont pas de `description`. Ajoutez-en une dans le YAML du modèle.",
    ),
    "fct_test_coverage": (
        "Couverture de tests insuffisante",
        "La part de modèles testés est sous le seuil configuré pour le package. "
        "Ajoutez des tests aux modèles qui n'en ont pas (voir aussi la règle des clés primaires).",
    ),
    "fct_documentation_coverage": (
        "Couverture de documentation insuffisante",
        "La part de modèles documentés est sous le seuil configuré. Ajoutez des descriptions.",
    ),
    "fct_hard_coded_references": (
        "Référence écrite en dur",
        "Ces modèles référencent une table directement au lieu de `ref()` ou `source()`. "
        "Remplacez la référence par `{{ ref('...') }}` ou `{{ source('...', '...') }}`.",
    ),
    "fct_direct_join_to_source": (
        "Jointure directe sur une source",
        "Ces modèles joignent une source directement. Passez par un modèle de staging "
        "puis joignez ce modèle.",
    ),
    "fct_marts_or_intermediate_dependent_on_source": (
        "Mart ou intermediate qui dépend d'une source",
        "Ces modèles lisent une source sans passer par le staging. Créez un modèle `stg_` "
        "et faites-le référencer à la place.",
    ),
    "fct_staging_dependent_on_staging": (
        "Staging dépendant d'un autre staging",
        "Un modèle de staging ne devrait dépendre que de sources. Déplacez la logique "
        "dans un modèle intermediate.",
    ),
    "fct_staging_dependent_on_marts_or_intermediate": (
        "Staging dépendant d'un mart ou d'un intermediate",
        "Le sens des dépendances est inversé : le staging doit être en amont de tout le reste.",
    ),
    "fct_unused_sources": (
        "Source inutilisée",
        "Ces sources ne sont référencées par aucun modèle. Utilisez-les ou supprimez-les.",
    ),
    "fct_duplicate_sources": (
        "Source en doublon",
        "Plusieurs sources pointent vers la même table. Gardez-en une seule.",
    ),
    "fct_root_models": (
        "Modèle sans parent",
        "Ces modèles ne dépendent d'aucun autre modèle ni source. Branchez-les sur `ref()`/`source()`.",
    ),
    "fct_too_many_joins": (
        "Trop de jointures dans un modèle",
        "Découpez ces modèles en plusieurs modèles intermediate plus simples.",
    ),
    "fct_model_fanout": (
        "Modèle avec trop d'enfants directs",
        "Ce modèle alimente beaucoup de modèles. Envisagez un modèle intermédiaire ou revoyez la modélisation.",
    ),
    "fct_chained_views_dependencies": (
        "Chaîne de vues trop longue",
        "Trop de vues enchaînées : matérialisez un des modèles en `table` pour casser la chaîne.",
    ),
}


def find_fct_name(unique_id: str) -> str | None:
    """Retrouve le modèle fct_* qui contient le détail d'un test du package."""
    match = re.search(r"\.is_empty_(fct_[a-z0-9_]+?)_\.", unique_id)
    if match:
        return match.group(1)
    if ".valid_test_coverage." in unique_id:
        return "fct_test_coverage"
    if ".valid_documentation_coverage." in unique_id:
        return "fct_documentation_coverage"
    match = re.search(r"\b(fct_[a-z0-9_]+)", unique_id)
    return match.group(1) if match else None


def cell(value, max_len: int = 120) -> str:
    text = "" if value is None else str(value)
    text = text.replace("|", "\\|").replace("\r", " ").replace("\n", " ")
    return text if len(text) <= max_len else text[: max_len - 1] + "…"


def fetch_rows(con, model: str, limit: int):
    found = con.execute(
        "SELECT table_schema FROM information_schema.tables WHERE table_name = ? ORDER BY table_schema",
        [model],
    ).fetchall()
    if not found:
        return None
    rel = f'"{found[0][0]}"."{model}"'
    columns = [d[0] for d in con.execute(f"SELECT * FROM {rel} LIMIT 0").description]
    total = con.execute(f"SELECT count(*) FROM {rel}").fetchone()[0]
    rows = con.execute(f"SELECT * FROM {rel} LIMIT {int(limit)}").fetchall()
    return columns, rows, total


def render_table(columns, rows) -> list[str]:
    lines = ["| " + " | ".join(cell(c) for c in columns) + " |"]
    lines.append("|" + "|".join("---" for _ in columns) + "|")
    lines += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows]
    return lines


def build_summary(run_results_path: Path, db_path: Path | None, max_rows: int) -> str:
    if not run_results_path.exists():
        return "## dbt project evaluator\n\nPas de run_results.json\n"

    results = json.loads(run_results_path.read_text())["results"]
    counts = collections.Counter(r["status"] for r in results)
    issues = [r for r in results if r["status"] in REPORTED_STATUSES]

    con = None
    if db_path is not None and db_path.exists():
        try:
            import duckdb

            con = duckdb.connect(str(db_path), read_only=True)
        except Exception as exc:  # le résumé de base doit toujours sortir
            print(f"Détail indisponible : {exc}", file=sys.stderr)

    icon = "❌" if any(r["status"] in ("error", "fail") for r in issues) else ("⚠️" if issues else "✅")
    lines = [f"## {icon} dbt project evaluator", ""]
    if not issues:
        lines.append("Aucune violation détectée.")
        return "\n".join(lines) + "\n"

    lines += ["| Statut | Nombre |", "|---|---|"]
    lines += [f"| {s} | {n} |" for s, n in sorted(counts.items())]
    lines += ["", "### Violations", "", f"Détail des règles : [documentation du package]({DOCS_URL}).", ""]

    for r in sorted(issues, key=lambda r: (r["status"], r["unique_id"])):
        model = find_fct_name(r["unique_id"])
        title, explanation = RULES.get(model, (model or r["unique_id"], None))
        failures = r.get("failures")
        count = f" · {failures} résultat(s)" if failures is not None else ""
        lines.append(f"<details><summary><b>{r['status']}</b> · {title}{count}</summary>")
        lines.append("")
        if explanation:
            lines += [explanation, ""]
        detail = None
        if con is not None and model:
            try:
                detail = fetch_rows(con, model, max_rows)
            except Exception as exc:
                lines += [f"_Détail indisponible ({cell(exc)})._", ""]
        if detail is not None:
            columns, rows, total = detail
            if rows:
                lines += render_table(columns, rows)
                if total > len(rows):
                    lines += ["", f"_{total - len(rows)} ligne(s) de plus non affichée(s)._"]
            else:
                lines.append("_Aucune ligne dans la table de détail._")
        elif con is not None and model:
            lines.append(f"_Table `{model}` introuvable dans la base._")
        else:
            message = (r.get("message") or "").strip()
            lines.append(f"`{r['unique_id']}`" + (f" : {message}" if message else ""))
        lines += ["", "</details>", ""]

    if con is not None:
        con.close()

    text = "\n".join(lines) + "\n"
    if len(text) > MAX_COMMENT_CHARS:
        text = text[:MAX_COMMENT_CHARS] + "\n\n_… résumé tronqué (voir le résumé du run pour le détail)._\n"
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path("target/run_results.json"))
    parser.add_argument("--db", type=Path, default=None, help="Base DuckDB contenant les tables fct_* du package")
    parser.add_argument("--max-rows", type=int, default=15, help="Lignes affichées par règle")
    args = parser.parse_args()
    sys.stdout.write(build_summary(args.path, args.db, args.max_rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())