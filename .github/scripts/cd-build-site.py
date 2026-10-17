#!/usr/bin/env python3
"""Construit le site du projet : un site complet par environnement.

Pour chaque environnement (prod, preprod) :
  1. copie les pages de docs/ en remplaçant __ENV__, __OTHER_ENV__ et __REPO__ ;
  2. construit le site MkDocs dans <out>/<env>/ ;
  3. génère la doc dbt depuis la base de l'environnement (<out>/<env>/dbt-docs/) ;
  4. exporte les tables en Parquet pour l'explorateur (<out>/<env>/data/) ;
  5. extrait les dashboards dbt Charts (<out>/<env>/charts/) et crée leur page d'accueil :
     un seul board = page d'accueil, plusieurs = liste.
Puis écrit la page d'accueil du site (<out>/index.html) qui renvoie vers les environnements.

Une étape facultative qui échoue (doc dbt, Parquet, dashboards) produit un avertissement
GitHub et n'empêche pas la publication du site. Seule la construction MkDocs est bloquante.

Usage (depuis la racine du repo) :
    python .github/scripts/build_site.py --repo "$GITHUB_REPOSITORY"
"""

import argparse
import html
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ENV_LABELS = {
    "prod": ("Production", "Versions publiées"),
    "preprod": ("Preprod", "Branche <code>main</code>"),
}


def warn(message: str) -> None:
    print(f"::warning::{message}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


# ---------------------------------------------------------------- 1 et 2 : MkDocs


def render_docs(src: Path, dst: Path, env: str, other: str, repo: str) -> None:
    """Copie docs/ en remplaçant les jetons par le nom de l'environnement et du dépôt."""
    shutil.copytree(src, dst)
    replacements = {"__ENV__": env, "__OTHER_ENV__": other, "__REPO__": repo}
    for path in dst.rglob("*"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # fichier binaire (image, police…)
        updated = text
        for token, value in replacements.items():
            updated = updated.replace(token, value)
        if updated != text:
            path.write_text(updated, encoding="utf-8")


def build_mkdocs(docs_dir: Path, out: Path, env: str) -> None:
    environment = {
        **os.environ,
        "DOCS_DIR": str(docs_dir),
        "NO_MKDOCS_2_WARNING": "true",  # bandeau d'avertissement de Material sur MkDocs 2.0
        "SITE_NAME": f"Projet fil rouge - Real Estate Analysis ({env})",
    }
    run([sys.executable, "-m", "mkdocs", "build", "-d", str(out)], env=environment)


# ---------------------------------------------------------------- 3 : doc dbt


def build_dbt_docs(project: Path, env: str, out: Path) -> None:
    run(["dbt", "docs", "generate", "--target", env], cwd=project)
    target = project / "target"
    dest = out / "dbt-docs"
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("index.html", "manifest.json", "catalog.json"):
        shutil.copy2(target / name, dest / name)


# ---------------------------------------------------------------- 4 : Parquet


def export_parquet(script: Path, db: Path, out: Path, env: str, schemas: str, max_table_mb: str) -> None:
    run(
        [
            sys.executable,
            str(script),
            "--env",
            env,
            "--db",
            str(db),
            "--out",
            str(out / "data"),
            "--schemas",
            schemas,
            "--max-table-mb",
            max_table_mb,
        ]
    )


# ---------------------------------------------------------------- 5 : dashboards

LIST_STYLE = (
    "body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}"
    "a{display:block;padding:.8rem 1rem;margin:.5rem 0;border:1px solid #ccc;"
    "border-radius:.4rem;text-decoration:none;color:inherit}a:hover{border-color:#b04267}"
)


def build_charts(archive: Path, out: Path, env: str) -> None:
    dest = out / "charts"
    dest.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as tar:
        tar.extractall(dest, filter="data")  # refuse les chemins sortant du dossier

    if (dest / "index.html").exists():
        return
    boards = sorted(p for p in dest.glob("*.html"))
    if len(boards) == 1:
        shutil.copy2(boards[0], dest / "index.html")
        return
    if not boards:
        warn(f"{env} : l'archive des dashboards ne contient aucun fichier .html")
        return
    links = "\n".join(
        f'<a href="{html.escape(p.name)}">{html.escape(p.stem)}</a>' for p in boards
    )
    (dest / "index.html").write_text(
        '<!doctype html><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>Dashboards ({html.escape(env)})</title><style>{LIST_STYLE}</style>"
        f"<h1>Dashboards ({html.escape(env)})</h1>\n{links}\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------- pages de repli

PLACEHOLDER = (
    '<!doctype html><html lang="fr"><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
    "<title>{title}</title><style>{style}</style>"
    "<h1>{title}</h1><p>{message}</p>"
    '<p><a href="{back}">← Retour à l\'accueil</a></p></html>'
)


def write_placeholder(directory: Path, title: str, message: str) -> None:
    """Page affichée tant qu'aucun déploiement n'a produit le contenu réel."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "index.html").write_text(
        PLACEHOLDER.format(
            title=html.escape(title),
            message=html.escape(message),
            style=LIST_STYLE.replace("a{display:block;", "a{display:inline;"),
            back="../index.html",
        ),
        encoding="utf-8",
    )


def add_placeholders(out: Path, env: str) -> None:
    """Les liens de la barre du haut doivent toujours mener quelque part."""
    if not (out / "dbt-docs" / "index.html").exists():
        write_placeholder(
            out / "dbt-docs",
            "Documentation dbt",
            f"Pas encore disponible : aucun déploiement {env} n'a généré la documentation.",
        )
    if not (out / "charts" / "index.html").exists():
        write_placeholder(
            out / "charts",
            "Dashboards",
            f"Pas encore disponible : aucun dashboard n'a été publié pour {env}.",
        )


# ---------------------------------------------------------------- page d'accueil


def write_root_index(site: Path, envs: list[str]) -> None:
    links = "\n".join(
        f'<a href="{env}/"><strong>{ENV_LABELS.get(env, (env, ""))[0]}</strong>'
        f"<br>{ENV_LABELS.get(env, ('', ''))[1]}</a>"
        for env in envs
    )
    (site / "index.html").write_text(
        '<!doctype html>\n<html lang="fr">\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>Projet fil rouge</title>\n<style>{LIST_STYLE.replace('40rem', '32rem')}</style>\n"
        f"<h1>Projet fil rouge</h1>\n{links}\n</html>\n",
        encoding="utf-8",
    )


def size_mb(path: Path) -> float:
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) / 1024 / 1024


# ---------------------------------------------------------------- orchestration


def build_env(env: str, other: str, args: argparse.Namespace) -> None:
    out = args.out / env
    db = args.project / f"{env}.duckdb"

    with tempfile.TemporaryDirectory() as tmp:
        docs_copy = Path(tmp) / "docs"
        render_docs(args.docs, docs_copy, env, other, args.repo)
        build_mkdocs(docs_copy.resolve(), out, env)

    if db.exists():
        try:
            build_dbt_docs(args.project, env, out)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
            warn(f"{env} : doc dbt non générée ({exc})")
        if not args.export_script.exists():
            warn(
                f"{env} : script d'export introuvable ({args.export_script}), "
                "l'explorateur SQL n'aura pas de données. "
                "Utilise --export-script pour indiquer son chemin."
            )
        else:
            try:
                export_parquet(
                    args.export_script, db, out, env, args.schemas, args.max_table_mb
                )
            except subprocess.CalledProcessError as exc:
                warn(f"{env} : export Parquet ignoré ({exc})")
            manifest = out / "data" / "manifest.json"
            if manifest.exists():
                files = list((out / "data").rglob("*.parquet"))
                print(f"{env} : {len(files)} fichier(s) Parquet, {size_mb(out / 'data'):.1f} Mo", flush=True)
            else:
                warn(
                    f"{env} : aucun manifest.json généré dans {out / 'data'} "
                    "(schémas filtrés trop strictement ? aucune table exportable ?)"
                )
    else:
        warn(f"{db.name} absent : doc dbt et données {env} ignorées.")

    archive = args.downloads / f"charts-{env}.tar.gz"
    if archive.exists():
        try:
            build_charts(archive, out, env)
        except (tarfile.TarError, OSError) as exc:
            warn(f"{env} : dashboards ignorés ({exc})")

    add_placeholders(out, env)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="Nom du dépôt (propriétaire/dépôt)")
    parser.add_argument("--envs", default="prod,preprod", help="Environnements, séparés par des virgules")
    parser.add_argument("--out", type=Path, default=Path("site"))
    parser.add_argument("--docs", type=Path, default=Path("docs"))
    parser.add_argument("--project", type=Path, default=Path("real_estate_analysis"))
    parser.add_argument("--downloads", type=Path, default=Path("real_estate_analysis/_downloads"))
    parser.add_argument("--export-script", type=Path, default=Path(".github/scripts/ci-export-parquet.py"))
    parser.add_argument("--schemas", default="", help="Schémas à exporter (défaut : tous)")
    parser.add_argument("--max-table-mb", default="100")
    args = parser.parse_args()

    envs = [e.strip() for e in args.envs.split(",") if e.strip()]
    args.out.mkdir(parents=True, exist_ok=True)

    if shutil.which("dbt"):
        try:
            run(["dbt", "deps"], cwd=args.project)
        except subprocess.CalledProcessError as exc:
            warn(f"dbt deps a échoué ({exc})")

    for env in envs:
        other = next((e for e in envs if e != env), env)
        print(f"::group::Site {env}", flush=True)
        try:
            build_env(env, other, args)
        finally:
            print("::endgroup::", flush=True)

    write_root_index(args.out, envs)

    total = size_mb(args.out)
    print(f"Taille du site : {total:.0f} Mo")
    if total > 900:
        warn(f"Site de {total:.0f} Mo, proche de la limite GitHub Pages (1 Go).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())