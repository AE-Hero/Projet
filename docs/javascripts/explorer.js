// Explorateur SQL : DuckDB-WASM dans le navigateur, données Parquet servies par le site.
// Les fichiers sont lus à la demande (requêtes HTTP Range) : rien n'est téléchargé en entier
// tant qu'une requête n'en a pas besoin.
//
// Interface : panneau de données à gauche (tables, colonnes, aperçu), éditeur à onglets
// en haut à droite, résultats en dessous.

const DUCKDB_VERSION = "1.29.0"; // à vérifier / mettre à jour
const DUCKDB_URL = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/+esm`;
const MAX_ROWS = 1000; // lignes affichées
const MAX_EXPORT_ROWS = 1_000_000; // lignes exportées en CSV
const STORE_KEY = `dbx-tabs-v1:${location.pathname}`;

const quote = (s) => `"${String(s).replaceAll('"', '""')}"`;

// ---------------------------------------------------------------- formatage

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

function isNumericType(type) {
  return /^(Int|Uint|Float|Decimal)/.test(String(type));
}

function toCsv(result) {
  const fields = result.schema.fields;
  const cols = fields.map((_, j) => result.getChildAt(j));
  const escape = (text) => (/[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  const lines = [fields.map((f) => escape(f.name)).join(",")];
  const n = Math.min(result.numRows, MAX_EXPORT_ROWS);
  for (let i = 0; i < n; i++) {
    lines.push(
      fields.map((f, j) => escape(formatValue(cols[j].get(i), f.type) ?? "")).join(",")
    );
  }
  return `﻿${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- interface

const TEMPLATE = `
<div class="dbx-tables">
  <div class="dbx-tables-head">
    <strong>Tables</strong>
    <span class="dbx-count" id="dbx-count"></span>
    <input class="dbx-search" id="dbx-search" type="search" placeholder="Filtrer tables et colonnes…" aria-label="Filtrer">
  </div>
  <div class="dbx-chips" id="dbx-chips"></div>
  <div class="dbx-panel" id="dbx-panel" hidden></div>
</div>
<div class="dbx-tabs" id="dbx-tabs" role="tablist"></div>
<div class="dbx-toolbar">
  <button class="dbx-btn dbx-btn-primary" id="dbx-run" type="button" disabled>▶ Exécuter</button>
  <span class="dbx-hint">Ctrl+Entrée · exécute la sélection s'il y en a une</span>
  <span class="dbx-spacer"></span>
  <button class="dbx-btn" id="dbx-csv" type="button" disabled>⬇ CSV</button>
</div>
<div class="dbx-editor"><textarea id="dbx-sql" spellcheck="false" aria-label="Requête SQL"></textarea></div>
<div class="dbx-split" id="dbx-split" role="separator" aria-orientation="horizontal" title="Glisser pour redimensionner"></div>
<div class="dbx-results">
  <div class="dbx-result-bar" id="dbx-info">Chargement…</div>
  <div class="dbx-result-body" id="dbx-result"></div>
</div>
`;

function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fitHeight(root) {
  const top = root.getBoundingClientRect().top + window.scrollY;
  root.style.height = `${Math.max(440, window.innerHeight - top - 12)}px`;
}

// Onglets de requêtes, conservés dans le navigateur (par site).
function loadTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (saved?.tabs?.length) return saved;
  } catch {
    /* stockage indisponible : on repart d'un onglet vide */
  }
  return null;
}

function saveTabs(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* ignoré */
  }
}

async function loadDuckDB(setInfo) {
  setInfo("Chargement de DuckDB…");
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
  return { duckdb, db, conn: await db.connect() };
}

async function init(root) {
  document.body.classList.add("dbx-page");
  root.classList.add("dbx");
  root.innerHTML = TEMPLATE;
  fitHeight(root);
  window.addEventListener("resize", () => fitHeight(root));

  const $ = (id) => root.querySelector(`#${id}`);
  const chipsEl = $("dbx-chips");
  const panelEl = $("dbx-panel");
  const tabsEl = $("dbx-tabs");
  const sqlEl = $("dbx-sql");
  const runBtn = $("dbx-run");
  const csvBtn = $("dbx-csv");
  const infoEl = $("dbx-info");
  const resultEl = $("dbx-result");
  const searchEl = $("dbx-search");

  const setInfo = (text, kind = "") => {
    infoEl.textContent = text;
    infoEl.dataset.kind = kind;
  };

  // Barre de séparation éditeur / résultats
  const split = $("dbx-split");
  split.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    split.setPointerCapture(event.pointerId);
    const move = (e) => {
      const rect = root.getBoundingClientRect();
      const top = root.querySelector(".dbx-editor").getBoundingClientRect().top;
      const height = Math.min(Math.max(e.clientY - top, 80), rect.bottom - top - 140);
      root.style.setProperty("--dbx-editor-h", `${height}px`);
    };
    const stop = () => {
      split.removeEventListener("pointermove", move);
      split.removeEventListener("pointerup", stop);
    };
    split.addEventListener("pointermove", move);
    split.addEventListener("pointerup", stop);
  });

  // ------------------------------------------------------------ catalogue
  const base = new URL(root.dataset.base, window.location.href);
  setInfo("Chargement du catalogue des données…");
  let manifest;
  try {
    const resp = await fetch(new URL("manifest.json", base));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    manifest = await resp.json();
  } catch {
    setInfo(
      "Aucune donnée publiée pour le moment : l'explorateur sera disponible après un déploiement.",
      "error"
    );
    return;
  }

  const { duckdb, db, conn } = await loadDuckDB(setInfo);

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
    setInfo("Aucune table exportée pour l'explorateur.", "error");
    return;
  }

  // ------------------------------------------------------------ éditeur et onglets
  const metaConn = await db.connect(); // connexion dédiée aux métadonnées
  const first = available[0];
  const firstSql = `SELECT *\nFROM ${first.env}.${first.view}\nLIMIT 100;`;
  const state = loadTabs() ?? { tabs: [{ id: 1, name: "Requête 1", sql: firstSql }], active: 1, next: 2 };
  const activeTab = () => state.tabs.find((t) => t.id === state.active) ?? state.tabs[0];

  const persist = () => saveTabs(state);

  const renderTabs = () => {
    tabsEl.replaceChildren();
    for (const tab of state.tabs) {
      const item = node("div", `dbx-tab${tab.id === activeTab().id ? " is-active" : ""}`);
      item.setAttribute("role", "tab");
      const label = node("button", "dbx-tab-label", tab.name);
      label.type = "button";
      label.addEventListener("click", () => selectTab(tab.id));
      label.addEventListener("dblclick", () => {
        const name = prompt("Nom de l'onglet", tab.name);
        if (name?.trim()) {
          tab.name = name.trim();
          persist();
          renderTabs();
        }
      });
      item.appendChild(label);
      const close = node("button", "dbx-tab-close", "×");
      close.type = "button";
      close.title = "Fermer l'onglet";
      close.addEventListener("click", () => closeTab(tab.id));
      item.appendChild(close);
      tabsEl.appendChild(item);
    }
    const add = node("button", "dbx-tab-add", "+");
    add.type = "button";
    add.title = "Nouvelle requête";
    add.addEventListener("click", () => newTab(""));
    tabsEl.appendChild(add);
  };

  const selectTab = (id) => {
    state.active = id;
    sqlEl.value = activeTab().sql;
    persist();
    renderTabs();
    sqlEl.focus();
  };

  const newTab = (sql) => {
    const id = state.next++;
    state.tabs.push({ id, name: `Requête ${id}`, sql });
    selectTab(id);
  };

  const closeTab = (id) => {
    const index = state.tabs.findIndex((t) => t.id === id);
    state.tabs.splice(index, 1);
    if (!state.tabs.length) {
      state.tabs.push({ id: state.next, name: `Requête ${state.next}`, sql: "" });
      state.next += 1;
    }
    selectTab(state.tabs[Math.min(index, state.tabs.length - 1)].id);
  };

  sqlEl.value = activeTab().sql;
  sqlEl.addEventListener("input", () => {
    activeTab().sql = sqlEl.value;
    persist();
  });

  const insertAtCursor = (text) => {
    sqlEl.setRangeText(text, sqlEl.selectionStart, sqlEl.selectionEnd, "end");
    activeTab().sql = sqlEl.value;
    persist();
    sqlEl.focus();
  };

  // ------------------------------------------------------------ exécution
  let lastResult = null;

  const renderResult = (result) => {
    const fields = result.schema.fields;
    const cols = fields.map((_, j) => result.getChildAt(j));
    const shown = Math.min(result.numRows, MAX_ROWS);

    const table = node("table", "dbx-grid");
    const head = table.createTHead().insertRow();
    head.appendChild(node("th", "dbx-rownum", "#"));
    for (const f of fields) {
      const th = node("th", isNumericType(f.type) ? "dbx-num" : "", f.name);
      th.title = `${f.name} · ${String(f.type)}`;
      head.appendChild(th);
    }
    const body = table.createTBody();
    for (let i = 0; i < shown; i++) {
      const tr = body.insertRow();
      tr.appendChild(node("td", "dbx-rownum", String(i + 1)));
      fields.forEach((f, j) => {
        const td = tr.insertCell();
        const text = formatValue(cols[j].get(i), f.type);
        if (text === null) {
          td.textContent = "NULL";
          td.className = "dbx-null";
        } else {
          td.textContent = text;
          if (isNumericType(f.type)) td.className = "dbx-num";
        }
      });
    }
    resultEl.replaceChildren(table);
    return shown;
  };

  const run = async () => {
    const selected = sqlEl.value.slice(sqlEl.selectionStart, sqlEl.selectionEnd).trim();
    const sql = selected || sqlEl.value.trim();
    if (!sql) return;
    runBtn.disabled = true;
    csvBtn.disabled = true;
    setInfo("Exécution…");
    const t0 = performance.now();
    try {
      const result = await conn.query(sql);
      const shown = renderResult(result);
      lastResult = result;
      const ms = Math.round(performance.now() - t0);
      const total = result.numRows.toLocaleString("fr-FR");
      setInfo(
        result.numRows > shown
          ? `${total} lignes (${shown.toLocaleString("fr-FR")} affichées) · ${ms} ms`
          : `${total} ligne${result.numRows > 1 ? "s" : ""} · ${ms} ms`,
        "ok"
      );
      csvBtn.disabled = result.numRows === 0;
    } catch (err) {
      resultEl.replaceChildren(node("pre", "dbx-error", String(err.message ?? err)));
      setInfo("Erreur", "error");
      lastResult = null;
    } finally {
      runBtn.disabled = false;
    }
  };

  runBtn.addEventListener("click", run);
  csvBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const url = URL.createObjectURL(new Blob([toCsv(lastResult)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `resultat-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  sqlEl.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      insertAtCursor("  ");
    } else if (e.key === "Escape") {
      sqlEl.blur(); // permet de quitter le champ au clavier
    }
  });

  // ------------------------------------------------------------ bandeau de tables
  $("dbx-count").textContent = `${available.length} table${available.length > 1 ? "s" : ""}`;

  const entries = available.map((t) => ({
    ...t,
    qualified: `${t.env}.${t.view}`,
    key: t.view.toLowerCase(),
    columns: null,
    chip: null,
  }));

  const loadColumns = async (entry) => {
    if (entry.columns) return;
    const info = await metaConn.query(`DESCRIBE ${quote(entry.env)}.${quote(entry.view)}`);
    const names = info.getChildAt(0);
    const types = info.getChildAt(1);
    entry.columns = [];
    for (let i = 0; i < info.numRows; i++) {
      entry.columns.push({ name: String(names.get(i)), type: String(types.get(i)) });
    }
  };

  let openEntry = null;

  const renderPanel = (entry) => {
    panelEl.replaceChildren();
    const head = node("div", "dbx-panel-head");
    head.appendChild(node("strong", "", entry.qualified));
    head.appendChild(
      node(
        "span",
        "dbx-panel-meta",
        `${entry.rows.toLocaleString("fr-FR")} lignes${entry.sampled ? " · échantillon" : ""}`
      )
    );
    const insert = node("button", "dbx-btn dbx-btn-small", "Insérer le nom");
    insert.type = "button";
    insert.addEventListener("click", () => insertAtCursor(entry.qualified));
    const preview = node("button", "dbx-btn dbx-btn-small", "▶ Aperçu (100 lignes)");
    preview.type = "button";
    preview.addEventListener("click", () => {
      newTab(`SELECT *\nFROM ${entry.qualified}\nLIMIT 100;`);
      run();
    });
    const close = node("button", "dbx-btn dbx-btn-small", "×");
    close.type = "button";
    close.title = "Fermer";
    close.addEventListener("click", () => togglePanel(entry));
    head.append(node("span", "dbx-spacer"), insert, preview, close);
    panelEl.appendChild(head);

    const list = node("div", "dbx-cols");
    if (!entry.columns) {
      list.textContent = "Chargement des colonnes…";
    } else {
      for (const column of entry.columns) {
        const pill = node("button", "dbx-col");
        pill.type = "button";
        pill.title = `Insérer ${column.name}`;
        pill.append(node("span", "", column.name), node("small", "", column.type));
        pill.addEventListener("click", () => insertAtCursor(column.name));
        list.appendChild(pill);
      }
    }
    panelEl.appendChild(list);
  };

  const togglePanel = async (entry) => {
    for (const e of entries) e.chip.classList.remove("is-active");
    if (openEntry === entry) {
      openEntry = null;
      panelEl.hidden = true;
      return;
    }
    openEntry = entry;
    entry.chip.classList.add("is-active");
    panelEl.hidden = false;
    renderPanel(entry);
    if (!entry.columns) {
      try {
        await loadColumns(entry);
      } catch (err) {
        panelEl.querySelector(".dbx-cols").textContent = String(err.message ?? err);
        return;
      }
      if (openEntry === entry) renderPanel(entry);
    }
  };

  for (const entry of entries) {
    const chip = node("button", "dbx-chip");
    chip.type = "button";
    chip.title = `${entry.qualified} · cliquer pour voir les colonnes`;
    chip.append(node("span", "", entry.view), node("small", "", entry.rows.toLocaleString("fr-FR")));
    chip.addEventListener("click", () => togglePanel(entry));
    entry.chip = chip;
    chipsEl.appendChild(chip);
  }

  // Filtre : nom de table, ou nom de colonne une fois les colonnes chargées
  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    for (const entry of entries) {
      const match =
        !q ||
        entry.key.includes(q) ||
        (entry.columns ?? []).some((c) => c.name.toLowerCase().includes(q));
      entry.chip.hidden = !match;
    }
  });

  // Les colonnes sont chargées en arrière-plan pour que le filtre les trouve
  (async () => {
    for (const entry of entries) {
      try {
        await loadColumns(entry);
      } catch {
        /* une table illisible n'empêche pas l'explorateur de fonctionner */
      }
    }
  })();

  renderTabs();
  runBtn.disabled = false;
  setInfo("Prêt. Ctrl+Entrée pour exécuter.", "ok");
}

const root = document.getElementById("explorer");
if (root) {
  init(root).catch((err) => {
    const info = root.querySelector("#dbx-info");
    if (info) {
      info.textContent = `Erreur au chargement de l'explorateur : ${err.message ?? err}`;
      info.dataset.kind = "error";
    }
    console.error(err);
  });
}