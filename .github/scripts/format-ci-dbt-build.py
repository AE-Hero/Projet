#!/usr/bin/env python3
"""Génère un résumé Markdown de target/run_results.json pour GitHub Actions.

Usage :
    python scripts/dbt_summary.py >> "$GITHUB_STEP_SUMMARY"
    python scripts/dbt_summary.py --path target/run_results.json
"""

import argparse
import collections
import json
import sys
from pathlib import Path

FAILED_STATUSES = ("error", "fail")


def build_summary(run_results_path: Path) -> str:
    if not run_results_path.exists():
        return f"Pas de {run_results_path.name}"

    results = json.loads(run_results_path.read_text())["results"]
    counts = collections.Counter(r["status"] for r in results)

    lines = ["## Résultat dbt build", "", "| Statut | Nombre |", "|---|---|"]
    lines += [f"| {status} | {n} |" for status, n in sorted(counts.items())]

    failed = [r for r in results if r["status"] in FAILED_STATUSES]
    if failed:
        lines += ["", "### En échec", ""]
        lines += [f"- `{r['unique_id']}` : {r['status']}" for r in failed]

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