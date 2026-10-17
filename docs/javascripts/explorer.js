// Explorateur SQL : DuckDB-WASM dans le navigateur, données Parquet servies par le site.
// Les fichiers sont lus à la demande (requêtes HTTP Range) : rien n'est téléchargé en entier
// tant qu'une requête n'en a pas besoin.

const DUCKDB_VERSION = "1.29.0"; // à vérifier / mettre à jour
const DUCKDB_URL = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
const MAX_ROWS = 1000;

const quote = (s) => `"${String(s).replaceAll('"', '""')}"`;

function decimalToString(words, scale) {
  let n = 0n;
  for (let i = words.length - 1; i >= 0; i--) n = (n << 32n) | BigInt(words[i]);
  if (words[words.length - 1] & 0x80000000) n -= 1n << BigInt(32 * words.length);
  const negative = n < 0n;
  let digits = (negative ? -n : n).toString().padStart(scale + 1, "0");
  if (scale > 0) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return (negative ? "-" : "") + digits;
}

function formatValue(value, type) {
  if (value === null || value === undefined) return null;
  const t = String(type);
  if (typeof value === "bigint") return value.toString();
  if (t.startsWith("Decimal") && ArrayBuffer.isView(value)) {
    return decimalToString(value, type.scale ?? 0);
  }
  if (typeof value === "number") {
    if (t.startsWith("Date")) return new Date(value).toISOString().slice(0, 10);
    if (t.startsWith("Timestamp")) {
      return new Date(value).toISOString().replace("T", " ").slice(0, 19);
    }
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderResult(container, result) {
  container.replaceChildren();
  const fields = result.schema.fields;
  const rows = result.toArray();
  const shown = rows.slice(0, MAX_ROWS);

  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const f of fields) {
    const th = document.createElement("th");
    th.textContent = f.name;
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const row of shown) {
    const tr = body.insertRow();
    for (const f of fields) {
      const td = tr.insertCell();
      const text = formatValue(row[f.name], f.type);
      if (text === null) {
        td.textContent = "NULL";
        td.className = "dbx-null";
      } else {
        td.textContent = text;
      }
    }
  }
  container.appendChild(table);
  return { total: rows.length, shown: shown.length };
}

async function init(root) {
  const $ = (id) => root.querySelector(`#${id}`);
  const statusEl = $("dbx-status");
  const infoEl = $("dbx-info");
  const sqlEl = $("dbx-sql");
  const runBtn = $("dbx-run");
  const resultEl = $("dbx-result");
  const tablesEl = $("dbx-tables");

  const setStatus = (msg, kind = "") => {
    statusEl.textContent = msg;
    statusEl.dataset.kind = kind;
  };

  const base = new URL(root.dataset.base, window.location.href);

  setStatus("Chargement du catalogue des données…");
  let manifest;
  try {
    const resp = await fetch(new URL("manifest.json", base));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    manifest = await resp.json();
  } catch {
    setStatus(
      "Aucune donnée publiée pour le moment : l'explorateur sera disponible après un déploiement.",
      "error"
    );
    return;
  }

  setStatus("Chargement de DuckDB…");
  const duckdb = await import(DUCKDB_URL);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
  );
  const db = new duckdb.AsyncDuckDB(
    new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
    new Worker(workerUrl)
  );
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();

  const available = [];
  for (const [env, info] of Object.entries(manifest.environments ?? {})) {
    if (!info.tables?.length) continue;
    await conn.query(`CREATE SCHEMA IF NOT EXISTS ${quote(env)}`);
    for (const t of info.tables) {
      const registered = t.file.replaceAll("/", "__");
      await db.registerFileURL(
        registered,
        new URL(t.file, base).href,
        duckdb.DuckDBDataProtocol.HTTP,
        false
      );
      await conn.query(
        `CREATE OR REPLACE VIEW ${quote(env)}.${quote(t.view)} AS SELECT * FROM read_parquet('${registered}')`
      );
      available.push({ env, ...t });
    }
  }

  if (!available.length) {
    setStatus("Aucune table exportée pour l'explorateur.", "error");
    return;
  }

  const setSql = (text) => {
    sqlEl.value = text;
    sqlEl.focus();
  };

  for (const t of available) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dbx-table";
    btn.textContent = `${t.env}.${t.view}`;
    const meta = document.createElement("small");
    meta.textContent = ` ${t.rows.toLocaleString("fr-FR")} lignes${t.sampled ? " · échantillon" : ""}`;
    btn.appendChild(meta);
    btn.addEventListener("click", () =>
      setSql(`SELECT *\nFROM ${t.env}.${t.view}\nLIMIT 100;`)
    );
    tablesEl.appendChild(btn);
  }

  const first = available[0];
  sqlEl.value = `SELECT *\nFROM ${first.env}.${first.view}\nLIMIT 100;`;

  const run = async () => {
    const sql = sqlEl.value.trim();
    if (!sql) return;
    runBtn.disabled = true;
    infoEl.textContent = "Exécution…";
    infoEl.dataset.kind = "";
    const t0 = performance.now();
    try {
      const result = await conn.query(sql);
      const { total, shown } = renderResult(resultEl, result);
      const ms = Math.round(performance.now() - t0);
      infoEl.textContent =
        total > shown
          ? `${total.toLocaleString("fr-FR")} lignes (${shown} affichées) · ${ms} ms`
          : `${total.toLocaleString("fr-FR")} lignes · ${ms} ms`;
    } catch (err) {
      resultEl.replaceChildren();
      infoEl.textContent = String(err.message ?? err);
      infoEl.dataset.kind = "error";
    } finally {
      runBtn.disabled = false;
    }
  };

  runBtn.addEventListener("click", run);
  sqlEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });

  runBtn.disabled = false;
  const envs = [...new Set(available.map((t) => t.env))].join(", ");
  setStatus(`Prêt. Les tables sont dans le schéma ${envs}.`, "ok");
}

const root = document.getElementById("explorer");
if (root) {
  init(root).catch((err) => {
    const statusEl = root.querySelector("#dbx-status");
    statusEl.textContent = `Erreur au chargement de l'explorateur : ${err.message ?? err}`;
    statusEl.dataset.kind = "error";
    console.error(err);
  });
}