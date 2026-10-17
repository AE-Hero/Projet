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
<aside class="dbx-side">
  <div class="dbx-side-head">
    <strong>Données</strong>
    <span class="dbx-side-count" id="dbx-count"></span>
  </div>
  <input class="dbx-search" id="dbx-search" type="search" placeholder="Filtrer tables et colonnes…" aria-label="Filtrer">
  <div class="dbx-tree" id="dbx-tree"></div>
</aside>
<section class="dbx-main">
  <div class="dbx-tabs" id="dbx-tabs" role="tablist"></div>
  <div class="dbx-toolbar">
    <button class="dbx-btn" id="dbx-toggle" type="button" title="Afficher / masquer le panneau de données">☰ Données</button>
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
</section>
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
  const treeEl = $("dbx-tree");
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

  $("dbx-toggle").addEventListener("click", () => root.classList.toggle("dbx-collapsed"));

  // Barre de séparation éditeur / résultats
  const split = $("dbx-split");
  split.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    split.setPointerCapture(event.pointerId);
    const main = root.querySelector(".dbx-main");
    const move = (e) => {
      const rect = main.getBoundingClientRect();
      const toolbarBottom = root.querySelector(".dbx-toolbar").getBoundingClientRect().bottom;
      const height = Math.min(Math.max(e.clientY - toolbarBottom, 70), rect.bottom - toolbarBottom - 120);
      main.style.setProperty("--dbx-editor-h", `${height}px`);
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
  const first = available[0];
  const firstSql = `SELECT *\nFROM ${first.env}.${first.view}\nLIMIT 100;`;
  const state = loadTabs() ?? { tabs: [{ id: 1, name: "Requête 1", sql: firstSql }], active: 1, next: 2 };
  let activeTab = () => state.tabs.find((t) => t.id === state.active) ?? state.tabs[0];

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
      tr.insertCell().outerHTML = `<td class="dbx-rownum">${i + 1}</td>`;
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

  // ------------------------------------------------------------ panneau de données
  $("dbx-count").textContent = `${available.length} table${available.length > 1 ? "s" : ""}`;

  const tableNodes = [];
  for (const env of [...new Set(available.map((t) => t.env))]) {
    const group = node("div", "dbx-group");
    const title = node("button", "dbx-group-title", env);
    title.type = "button";
    const list = node("div", "dbx-group-list");
    title.addEventListener("click", () => group.classList.toggle("is-closed"));
    group.append(title, list);
    treeEl.appendChild(group);

    for (const t of available.filter((x) => x.env === env)) {
      const qualified = `${t.env}.${t.view}`;
      const item = node("div", "dbx-item");
      const row = node("div", "dbx-item-row");

      const caret = node("button", "dbx-caret", "▸");
      caret.type = "button";
      caret.title = "Afficher les colonnes";
      const name = node("button", "dbx-item-name", t.view);
      name.type = "button";
      name.title = `Insérer ${qualified} dans la requête`;
      name.addEventListener("click", () => insertAtCursor(qualified));
      const meta = node(
        "span",
        "dbx-item-meta",
        `${t.rows.toLocaleString("fr-FR")}${t.sampled ? " · échantillon" : ""}`
      );
      const preview = node("button", "dbx-preview", "▶");
      preview.type = "button";
      preview.title = "Aperçu (100 premières lignes)";
      preview.addEventListener("click", () => {
        newTab(`SELECT *\nFROM ${qualified}\nLIMIT 100;`);
        run();
      });
      row.append(caret, name, meta, preview);

      const columnsEl = node("div", "dbx-columns");
      item.append(row, columnsEl);
      list.appendChild(item);

      const entry = { item, columnsEl, view: t.view.toLowerCase(), columns: null };
      tableNodes.push(entry);

      const loadColumns = async () => {
        if (entry.columns) return;
        const info = await conn.query(`DESCRIBE ${quote(t.env)}.${quote(t.view)}`);
        const names = info.getChildAt(0);
        const types = info.getChildAt(1);
        entry.columns = [];
        for (let i = 0; i < info.numRows; i++) {
          const column = String(names.get(i));
          const type = String(types.get(i));
          entry.columns.push(column.toLowerCase());
          const line = node("button", "dbx-column");
          line.type = "button";
          line.title = `Insérer ${column}`;
          line.append(node("span", "dbx-column-name", column), node("span", "dbx-column-type", type));
          line.addEventListener("click", () => insertAtCursor(column));
          columnsEl.appendChild(line);
        }
      };
      entry.loadColumns = loadColumns;

      caret.addEventListener("click", async () => {
        const open = item.classList.toggle("is-open");
        caret.textContent = open ? "▾" : "▸";
        if (open) await loadColumns();
      });
    }
  }

  // Filtre : nom de table, ou nom de colonne une fois les colonnes chargées
  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    for (const entry of tableNodes) {
      const match =
        !q || entry.view.includes(q) || (entry.columns ?? []).some((c) => c.includes(q));
      entry.item.hidden = !match;
    }
  });

  // Les colonnes sont chargées en arrière-plan pour que le filtre les trouve
  (async () => {
    for (const entry of tableNodes) {
      try {
        await entry.loadColumns();
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