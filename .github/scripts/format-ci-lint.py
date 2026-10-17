#!/usr/bin/env python3
"""Résumé Markdown (et annotations GitHub) à partir de la sortie JSON de SQLFluff.

Usage (depuis real_estate_analysis/) :
    sqlfluff lint --format json <fichiers> > lint.json 2> lint.err
    python ../.github/scripts/format-ci-lint.py --path lint.json --err lint.err > summary.md
    python ../.github/scripts/format-ci-lint.py --path lint.json --annotations \
        --prefix real_estate_analysis/
"""

import argparse
import json
import sys
from pathlib import Path

MAX_PER_FILE = 50
MAX_TOTAL_CHARS = 60_000  # un commentaire GitHub est limité à 65 536 caractères


def load(path: Path):
    """Retourne la liste des fichiers lintés, ou None si le JSON est absent ou invalide."""
    if not path.exists() or not path.read_text().strip():
        return None
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, list) else None


def cell(value) -> str:
    return str(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def escape_annotation(text: str) -> str:
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def build_summary(files, err_path: Path | None) -> str:
    if files is None:
        lines = ["## ❌ Lint SQL (SQLFluff)", "", "SQLFluff n'a pas produit de résultat exploitable."]
        if err_path is not None and err_path.exists() and err_path.read_text().strip():
            tail = "\n".join(err_path.read_text().strip().splitlines()[-20:])
            lines += ["", "<details><summary>Sortie d'erreur</summary>", "", "```text", tail, "```", "", "</details>"]
        return "\n".join(lines) + "\n"

    with_issues = [f for f in files if f.get("violations")]
    total = sum(len(f["violations"]) for f in with_issues)

    if not files:
        return "## ✅ Lint SQL (SQLFluff)\n\nAucun fichier SQL modifié.\n"
    if not with_issues:
        return f"## ✅ Lint SQL (SQLFluff)\n\nTout est ok : {len(files)} fichier(s) vérifié(s), aucune violation.\n"

    lines = [
        "## ❌ Lint SQL (SQLFluff)",
        "",
        f"**{total} violation(s)** dans {len(with_issues)} fichier(s) sur {len(files)} vérifié(s).",
        "",
    ]
    for f in sorted(with_issues, key=lambda f: f["filepath"]):
        violations = sorted(f["violations"], key=lambda v: (v.get("start_line_no", 0), v.get("start_line_pos", 0)))
        lines.append(f"<details open><summary><code>{f['filepath']}</code> · {len(violations)} violation(s)</summary>")
        lines += ["", "| Ligne | Règle | Description |", "|---|---|---|"]
        for v in violations[:MAX_PER_FILE]:
            lines.append(
                f"| {v.get('start_line_no', '?')}:{v.get('start_line_pos', '?')} "
                f"| `{cell(v.get('code', ''))}` | {cell(v.get('description', ''))} |"
            )
        if len(violations) > MAX_PER_FILE:
            lines += ["", f"_{len(violations) - MAX_PER_FILE} violation(s) de plus non affichée(s)._"]
        lines += ["", "</details>", ""]

    names = " ".join(f["filepath"] for f in sorted(with_issues, key=lambda f: f["filepath"]))
    lines += [
        "**Corriger automatiquement** (depuis `real_estate_analysis/`) :",
        "",
        "```bash",
        f"sqlfluff fix {names}",
        "```",
        "",
        "Relisez le diff : certaines règles ne sont pas corrigeables automatiquement.",
    ]
    text = "\n".join(lines) + "\n"
    if len(text) > MAX_TOTAL_CHARS:
        text = text[:MAX_TOTAL_CHARS] + "\n\n_… résumé tronqué._\n"
    return text


def print_annotations(files, prefix: str) -> None:
    for f in files or []:
        for v in f.get("violations", []):
            level = "warning" if v.get("warning") else "error"
            message = escape_annotation(f"{v.get('code', '')}: {v.get('description', '')}")
            print(
                f"::{level} file={prefix}{f['filepath']},line={v.get('start_line_no', 1)},"
                f"col={v.get('start_line_pos', 1)},title=SQLFluff::{message}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, default=Path("lint.json"))
    parser.add_argument("--err", type=Path, default=None, help="Sortie d'erreur de SQLFluff")
    parser.add_argument("--annotations", action="store_true", help="Émet des annotations GitHub au lieu du Markdown")
    parser.add_argument("--prefix", default="", help="Préfixe de chemin pour les annotations (ex. real_estate_analysis/)")
    args = parser.parse_args()

    files = load(args.path)
    if args.annotations:
        print_annotations(files, args.prefix)
    else:
        sys.stdout.write(build_summary(files, args.err))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())