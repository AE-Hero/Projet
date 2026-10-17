#!/usr/bin/env python3
"""Génère un résumé Markdown de target/run_results.json pour GitHub Actions.

Usage :
    python ../.github/scripts/format-ci-dbt-build.py > summary.md
    python ../.github/scripts/format-ci-dbt-build.py --path target/run_results.json
"""

import argparse
import collections
import json
import sys
from pathlib import Path

FAILED_STATUSES = ("error", "fail")
WARNING_STATUSES = ("warn",)


def build_summary(run_results_path: Path) -> str:
    if not run_results_path.exists():
        return f"## Résultat dbt build\n\nPas de {run_results_path.name}\n"

    results = json.loads(run_results_path.read_text())["results"]
    counts = collections.Counter(r["status"] for r in results)
    failed = [r for r in results if r["status"] in FAILED_STATUSES]
    warned = [r for r in results if r["status"] in WARNING_STATUSES]

    icon = "❌" if failed else "✅"
    lines = [f"## {icon} Résultat dbt build", "", "| Statut | Nombre |", "|---|---|"]
    lines += [f"| {status} | {n} |" for status, n in sorted(counts.items())]

    if failed:
        lines += ["", "### En échec", ""]
        lines += [f"- `{r['unique_id']}` : {r['status']}" for r in failed]
    else:
        lines += ["", f"**Tout est ok** : {len(results)} ressource(s) exécutée(s) sans erreur."]

    if warned:
        lines += ["", f"⚠️ {len(warned)} avertissement(s) :", ""]
        lines += [f"- `{r['unique_id']}`" for r in warned]

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--path",
        type=Path,
        default=Path("target/run_results.json"),
        help="Chemin vers run_results.json (défaut : target/run_results.json)",
    )
    args = parser.parse_args()

    sys.stdout.write(build_summary(args.path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())