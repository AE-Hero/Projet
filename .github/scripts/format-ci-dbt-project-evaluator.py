#!/usr/bin/env python3
"""Résumé Markdown des résultats de dbt-project-evaluator.

Contrairement au résumé du build, les violations du package sont souvent au
niveau "warn" : on les liste donc en plus des erreurs.

Usage :
    python ../.github/scripts/format-ci-dbt-project-evaluator.py > summary.md
"""

import argparse
import collections
import json
import sys
from pathlib import Path

REPORTED_STATUSES = ("error", "fail", "warn")


def build_summary(run_results_path: Path) -> str:
    if not run_results_path.exists():
        return "## dbt project evaluator\n\nPas de run_results.json\n"

    results = json.loads(run_results_path.read_text())["results"]
    counts = collections.Counter(r["status"] for r in results)
    issues = [r for r in results if r["status"] in REPORTED_STATUSES]

    lines = ["## dbt project evaluator", ""]
    if not issues:
        lines.append("Aucune violation détectée.")
    else:
        lines += ["| Statut | Nombre |", "|---|---|"]
        lines += [f"| {s} | {n} |" for s, n in sorted(counts.items())]
        lines += ["", "### Violations", ""]
        for r in sorted(issues, key=lambda r: (r["status"], r["unique_id"])):
            message = (r.get("message") or "").strip()
            suffix = f" — {message}" if message else ""
            lines.append(f"- **{r['status']}** `{r['unique_id']}`{suffix}")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path("target/run_results.json"))
    args = parser.parse_args()
    sys.stdout.write(build_summary(args.path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())