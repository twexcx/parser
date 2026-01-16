// app.js
"use strict";

/**
 * API: /search, /enrich (см README) :contentReference[oaicite:2]{index=2}
 * Фронт: переписан под нормальную работу с API и настройками (localStorage).
 */

const STORAGE_KEY = "TD_PARSER_CONFIG_V1";

const DEFAULT_CONFIG = {
  apiUrl: "https://company-finder-api-production.up.railway.app",
  defaultMax: 20,
  enrichWithRusprofile: true,

  // Пороги в млн ₽ (UI-логика), внутри переводим в ₽
  priority: {
    aMinM: 100,
    bMinM: 10
  },

  rings: {
    1: { fromKm: 0, toKm: 300, max: 20 },
    2: { fromKm: 300, toKm: 500, max: 20 },
    3: { fromKm: 500, toKm: 700, max: 20 },
    4: { fromKm: 700, toKm: 1000, max: 20 },
    5: { fromKm: 1000, toKm: 1500, max: 20 }
  }
};

let config = loadConfig();

// state
let isLoading = false;
let companies = [];
let filteredCompanies = [];
let selected = new Set(); // ids

// ========= utils =========
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("is-hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("is-hidden"), 2200);
}

function formatDateRu(d = new Date()) {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function parseMoneyToNumber(value) {
  // revenue приходит строкой типа "10 000 000" — оставляем цифры
  if (value == null) return 0;
  const s = String(value);
  const n = Number(s.replace(/[^\d]/g, "")) || 0;
  return n;
}

function formatTurnoverRub(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + " млрд";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(0) + " млн";
  if (num >= 1_000) return (num / 1_000).toFixed(0) + " тыс";
  return String(num);
}

function priorityFromRevenue(revenueRub) {
  const aMin = (Number(config.priority.aMinM) || 0) * 1_000_000;
  const bMin = (Number(config.priority.bMinM) || 0) * 1_000_000;

  if (revenueRub >= aMin && aMin > 0) return "A";
  if (revenueRub >= bMin && bMin > 0) return "B";
  return "C";
}

function getPriorityClass(p) {
  return ({
    A: "priority priority--a",
    B: "priority priority--b",
    C: "priority priority--c"
  })[p] || "priority priority--c";
}

function ringColorClass(ring) {
  const r = Number(ring) || 0;
  if (r >= 1 && r <= 5) return `ring-color--${r}`;
  return "ring-color--0";
}

function safeText(v) {
  if (v == null) return "";
  return String(v);
}

// ========= config =========
function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    return deepMerge(structuredClone(DEFAULT_CONFIG), parsed);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function deepMerge(base, extra) {
  for (const k of Object.keys(extra || {})) {
    const v = extra[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      base[k] = deepMerge(base[k] ?? {}, v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

function applyConfigLabels() {
  // Rings labels (sidebar + select)
  for (let i = 1; i <= 5; i++) {
    const r = config.rings[i];
    const label = `${i} (${r.fromKm}-${r.toKm}км)`;

    const btn = document.getElementById(`ring-btn-${i}`);
    if (btn) btn.textContent = `Кольцо ${label}`;

    const opt = document.getElementById(`ring-opt-${i}`);
    if (opt) opt.textContent = label;
  }

  // Priority select labels
  const a = Number(config.priority.aMinM) || 0;
  const b = Number(config.priority.bMinM) || 0;

  const prA = $("#prio-opt-a");
  const prB = $("#prio-opt-b");
  const prC = $("#prio-opt-c");

  if (prA) prA.textContent = `A (>${a}М)`;
  if (prB) prB.textContent = `B (${b}-${a}М)`;
  if (prC) prC.textContent = `C (<${b}М)`;
}

// ========= API =========
async function apiPost(path, body) {
  const url = `${config.apiUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const msg = (json && (json.detail || json.message)) ? (json.detail || json.message) : (text || `HTTP ${res.status}`);
    throw new Error(msg);
  }
  return json ?? {};
}

async function apiSearch(query, maxCompanies) {
  return apiPost("/search", {
    query,
    enrich_with_rusprofile: Boolean(config.enrichWithRusprofile),
    max_companies: Number(maxCompanies) || Number(config.defaultMax) || 20
  });
}

async function apiEnrich(innList) {
  return apiPost("/enrich", innList);
}

// ========= loading indicator =========
function setLoading(on, text = "Запрос…") {
  isLoading = on;
  const ind = $("#running-indicator");
  const t = $("#running-text");
  if (t) t.textContent = text;
  if (!ind) return;

  if (on) ind.classList.remove("is-hidden");
  else ind.classList.add("is-hidden");

  // disable some buttons during loading
  const disable = (sel, v) => {
    const el = $(sel);
    if (el) el.disabled = v;
  };
  disable("#btn-search", on);
  disable("#btn-export", on);
  disable("#btn-enrich-selected", on);
}

// ========= view navigation =========
function setView(view) {
  $all(".view").forEach(v => v.classList.remove("is-active"));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add("is-active");

  $all(".nav-item").forEach(n => n.classList.remove("nav-item--active"));
  const nav = $all("[data-nav]").find(x => x.dataset.nav === view);
  if (nav && nav.classList.contains("nav-item")) nav.classList.add("nav-item--active");

  const titles = {
    dashboard: "Панель управления",
    database: "База клиентов",
    telegram: "Telegram-рассылка",
    email: "Email-рассылка",
    stats: "Статистика",
    pricelist: "Прайс-листы"
  };
  const title = titles[view] || view;
  const h = $("#page-title");
  if (h) h.textContent = title;

  // update recipients hints in messaging views
  updateSelectedUI();
}

// ========= mapping company =========
function mapCompany(apiCompany, ringNum, idx) {
  const revenue = parseMoneyToNumber(apiCompany.revenue);
  const priority = priorityFromRevenue(revenue);

  const phones = Array.isArray(apiCompany.phones) ? apiCompany.phones : [];
  const emails = Array.isArray(apiCompany.emails) ? apiCompany.emails : [];

  return {
    id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
    ring: Number(ringNum) || 0,

    name: apiCompany.short_name || apiCompany.name || "—",
    inn: apiCompany.inn || "—",
    okved: apiCompany.okved || "—",

    // у API в примере есть legal_address, city может не быть :contentReference[oaicite:3]{index=3}
    cityOrAddress: apiCompany.city || apiCompany.legal_address || "—",

    revenueRub: revenue,
    priority,

    phone: phones[0] || "",
    email: emails[0] || "",
    contact: apiCompany.director_name || "",
    site: apiCompany.website || "",

    raw: apiCompany
  };
}

// ========= rendering =========
function renderCompaniesTable(data) {
  const tbody = $("#companies-table");
  if (!tbody) return;

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  for (const c of data) {
    const tr = document.createElement("tr");
    tr.className = "table-row";

    // checkbox
    const td0 = document.createElement("td");
    td0.className = "cell cell--check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(c.id);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(c.id);
      else selected.delete(c.id);
      updateSelectedUI();
      renderStatsAll();
    });
    td0.appendChild(cb);

    const tdName = document.createElement("td");
    tdName.className = "cell cell--strong";
    tdName.textContent = safeText(c.name);

    const tdInn = document.createElement("td");
    tdInn.className = "cell cell--muted";
    tdInn.textContent = safeText(c.inn);

    const tdCity = document.createElement("td");
    tdCity.className = "cell";
    tdCity.textContent = safeText(c.cityOrAddress);

    const tdOkved = document.createElement("td");
    tdOkved.className = "cell cell--muted";
    tdOkved.textContent = safeText(c.okved);

    const tdRev = document.createElement("td");
    tdRev.className = "cell";
    tdRev.textContent = `${formatTurnoverRub(c.revenueRub)} ₽`;

    const tdPr = document.createElement("td");
    tdPr.className = "cell";
    const pr = document.createElement("span");
    pr.className = getPriorityClass(c.priority);
    pr.textContent = c.priority;
    tdPr.appendChild(pr);

    const tdPhone = document.createElement("td");
    tdPhone.className = "cell";
    tdPhone.textContent = c.phone || "-";

    const tdEmail = document.createElement("td");
    tdEmail.className = "cell cell--link";
    tdEmail.textContent = c.email || "-";

    const tdContact = document.createElement("td");
    tdContact.className = "cell";
    tdContact.textContent = c.contact || "-";

    const tdAct = document.createElement("td");
    tdAct.className = "cell cell--actions";
    const btn = document.createElement("button");
    btn.className = "btn btn--link btn--tiny";
    btn.type = "button";
    btn.textContent = "Детали";
    btn.addEventListener("click", () => openDetails(c));
    tdAct.appendChild(btn);

    tr.appendChild(td0);
    tr.appendChild(tdName);
    tr.appendChild(tdInn);
    tr.appendChild(tdCity);
    tr.appendChild(tdOkved);
    tr.appendChild(tdRev);
    tr.appendChild(tdPr);
    tr.appendChild(tdPhone);
    tr.appendChild(tdEmail);
    tr.appendChild(tdContact);
    tr.appendChild(tdAct);

    frag.appendChild(tr);
  }

  tbody.appendChild(frag);

  const countEl = $("#companies-count");
  if (countEl) countEl.textContent = `Показано ${data.length} из ${companies.length} компаний`;
}

function renderRecent() {
  const tbody = $("#recent-table");
  if (!tbody) return;
  const slice = companies.slice(0, 5);

  tbody.innerHTML = slice.map(c => `
    <tr class="table-row">
      <td class="cell cell--strong">${escapeHtml(c.name)}</td>
      <td class="cell cell--muted">${escapeHtml(c.cityOrAddress)}</td>
      <td class="cell cell--muted">${escapeHtml(c.okved)}</td>
      <td class="cell">${escapeHtml(formatTurnoverRub(c.revenueRub))} ₽</td>
      <td class="cell"><span class="${getPriorityClass(c.priority)}">${c.priority}</span></td>
      <td class="cell">${escapeHtml(c.contact || "-")}</td>
    </tr>
  `).join("");
}

function renderStatsAll() {
  const total = companies.length;
  const a = companies.filter(x => x.priority === "A").length;
  const b = companies.filter(x => x.priority === "B").length;
  const c = companies.filter(x => x.priority === "C").length;

  const contact = companies.filter(x => x.contact && x.contact !== "-").length;

  setText("#stat-total", total);
  setText("#stat-a", a);
  setText("#stat-b", b);
  setText("#stat-c", c);
  setText("#stat-contact", contact);

  setText("#metric-found", total);
  setText("#metric-selected", selected.size);
  setText("#metric-email", companies.filter(x => x.email).length);
  setText("#metric-phone", companies.filter(x => x.phone).length);

  // bars
  const ringWrap = $("#ring-stats");
  if (ringWrap) {
    const ringData = [1,2,3,4,5].map(r => ({
      ring: r,
      count: companies.filter(x => x.ring === r).length
    }));

    ringWrap.innerHTML = ringData.map(r => `
      <div class="bar-row">
        <span class="bar-row__label">
          <span class="dot ${ringColorClass(r.ring)}"></span>
          <span>Кольцо ${r.ring}</span>
        </span>
        <span class="bar">
          <span class="bar__fill ${ringColorClass(r.ring)}" style="width:${total ? (r.count / total) * 100 : 0}%"></span>
        </span>
        <span class="bar-row__value">${r.count}</span>
      </div>
    `).join("");
  }

  const prioWrap = $("#priority-stats");
  if (prioWrap) {
    const prioData = ["A","B","C"].map(p => ({
      p,
      count: companies.filter(x => x.priority === p).length
    }));

    prioWrap.innerHTML = prioData.map(x => `
      <div class="bar-row">
        <span class="bar-row__label">
          <span class="${getPriorityClass(x.p)}">${x.p}</span>
        </span>
        <span class="bar">
          <span class="bar__fill ${x.p === "A" ? "ring-color--1" : x.p === "B" ? "ring-color--3" : "ring-color--0"}"
                style="width:${total ? (x.count / total) * 100 : 0}%"></span>
        </span>
        <span class="bar-row__value">${x.count}</span>
      </div>
    `).join("");
  }
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = String(value);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ========= filters =========
function applyFilters() {
  const q = ($("#filter-search")?.value || "").trim().toLowerCase();
  const region = $("#filter-region")?.value || "";
  const ring = $("#filter-ring")?.value || "";
  const priority = $("#filter-priority")?.value || "";
  const okved = $("#filter-okved")?.value || "";
  const contacts = $("#filter-contacts")?.value || "";

  filteredCompanies = companies.filter(c => {
    if (q) {
      const hay = `${c.name} ${c.inn}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (region) {
      // у нас "cityOrAddress" — берём contains
      if (!c.cityOrAddress.toLowerCase().includes(region.toLowerCase())) return false;
    }
    if (ring && String(c.ring) !== String(ring)) return false;
    if (priority && c.priority !== priority) return false;
    if (okved && !String(c.okved || "").startsWith(okved)) return false;

    if (contacts === "phone" && !c.phone) return false;
    if (contacts === "email" && !c.email) return false;
    if (contacts === "both" && (!c.phone || !c.email)) return false;

    return true;
  });

  renderCompaniesTable(filteredCompanies);
}

function clearFiltersOnly() {
  const ids = ["filter-region","filter-ring","filter-priority","filter-okved","filter-contacts"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  applyFilters();
}

// ========= selection =========
function updateSelectedUI() {
  setText("#selected-count", `Выбрано: ${selected.size}`);
  setText("#metric-selected", selected.size);

  const tg = $("#tg-selected-hint");
  const em = $("#email-selected-hint");
  const pr = $("#pricelist-selected-hint");
  if (tg) tg.textContent = `Выбрано: ${selected.size}`;
  if (em) em.textContent = `Выбрано: ${selected.size}`;
  if (pr) pr.textContent = `Выбрано: ${selected.size}`;
}

function selectAllFiltered(checked) {
  if (checked) {
    for (const c of filteredCompanies) selected.add(c.id);
  } else {
    for (const c of filteredCompanies) selected.delete(c.id);
  }
  updateSelectedUI();
  renderCompaniesTable(filteredCompanies);
  renderStatsAll();
}

function selectAllAll() {
  for (const c of companies) selected.add(c.id);
  updateSelectedUI();
  applyFilters();
  renderStatsAll();
}

function clearSelection() {
  selected.clear();
  const cb = $("#select-all-cb");
  if (cb) cb.checked = false;
  updateSelectedUI();
  applyFilters();
  renderStatsAll();
}

// ========= actions: search/rings/enrich/export =========
async function runRing(ringNum) {
  if (isLoading) return;
  const r = config.rings[ringNum];
  const region = ($("#filter-region")?.value || "Самара").trim() || "Самара";
  const max = Number(r?.max) || Number(config.defaultMax) || 20;

  // Важно: формируем “человеческий” запрос как раньше, но уже из настроек
  const query = `Найди ${max} компаний в кольце ${ringNum} (${r.fromKm}-${r.toKm}км) в ${region}`;

  await runSearchQuery(query, max, ringNum);
}

async function runTextSearch() {
  if (isLoading) return;

  const raw = ($("#filter-search")?.value || "").trim();
  if (!raw) {
    toast("Введите запрос");
    return;
  }

  // Если выбрали регион/кольцо — добавим к запросу, чтобы AI точнее
  const region = ($("#filter-region")?.value || "").trim();
  const ring = ($("#filter-ring")?.value || "").trim();

  let query = raw;
  if (region) query += `. Регион: ${region}.`;
  if (ring) {
    const rr = config.rings[ring];
    if (rr) query += ` Кольцо: ${ring} (${rr.fromKm}-${rr.toKm}км).`;
  }

  await runSearchQuery(query, Number(config.defaultMax) || 20, ring ? Number(ring) : 0);
}

async function runSearchQuery(query, max, ringNumForMap) {
  setLoading(true, "Запрос к API…");
  try {
    const data = await apiSearch(query, max);
    const list = Array.isArray(data.companies) ? data.companies : [];

    companies = list.map((c, i) => mapCompany(c, ringNumForMap, i));
    filteredCompanies = companies.slice();

    // если запрос был по кольцу — проставим ring всем
    if (ringNumForMap) {
      for (const c of companies) c.ring = Number(ringNumForMap);
    }

    // после обновления данных выбор сбрасываем (чтобы не “плыли” id)
    selected.clear();
    const cb = $("#select-all-cb");
    if (cb) cb.checked = false;

    applyFilters();
    renderRecent();
    renderStatsAll();
    updateSelectedUI();

    setView("database");
    toast(`Готово: ${companies.length} компаний`);
  } catch (e) {
    toast(`Ошибка: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

async function enrichSelected() {
  if (isLoading) return;

  const ids = Array.from(selected);
  if (ids.length === 0) {
    toast("Ничего не выбрано");
    return;
  }

  const innList = ids
    .map(id => companies.find(c => c.id === id))
    .filter(Boolean)
    .map(c => c.inn)
    .filter(inn => inn && inn !== "—");

  if (innList.length === 0) {
    toast("У выбранных нет ИНН");
    return;
  }

  setLoading(true, "Enrich…");
  try {
    const enriched = await apiEnrich(innList);

    // ожидаем { companies: [...] } или просто массив — на всякий случай
    const list = Array.isArray(enriched) ? enriched : (Array.isArray(enriched.companies) ? enriched.companies : []);
    const byInn = new Map(list.map(x => [String(x.inn || ""), x]));

    companies = companies.map(c => {
      const upd = byInn.get(String(c.inn || ""));
      if (!upd) return c;

      const merged = mapCompany(upd, c.ring, 0);
      merged.id = c.id; // сохраняем id, чтобы не потерять selection
      merged.ring = c.ring;
      return merged;
    });

    applyFilters();
    renderRecent();
    renderStatsAll();
    updateSelectedUI();
    toast("Enrich выполнен");
  } catch (e) {
    toast(`Enrich ошибка: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

function exportCsv() {
  const rows = [
    ["name","inn","ring","cityOrAddress","okved","revenueRub","priority","phone","email","contact","site"]
  ];

  for (const c of companies) {
    rows.push([
      c.name, c.inn, String(c.ring),
      c.cityOrAddress, c.okved,
      String(c.revenueRub),
      c.priority,
      c.phone, c.email, c.contact, c.site
    ]);
  }

  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    // csv-escaping
    if (/[",\n;]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }).join(";")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `companies_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  toast("CSV скачан");
}

// ========= payload generators =========
function getSelectedCompanies() {
  return companies.filter(c => selected.has(c.id));
}

async function copyJson(obj) {
  const text = JSON.stringify(obj, null, 2);
  await navigator.clipboard.writeText(text);
  toast("Скопировано в буфер");
}

async function telegramCopy() {
  const list = getSelectedCompanies();
  if (list.length === 0) return toast("Ничего не выбрано");

  const text = ($("#tg-text")?.value || "").trim();
  const personalize = Boolean($("#tg-personalize")?.checked);

  const payload = {
    channel: "telegram",
    message_template: text,
    personalize,
    recipients: list.map(c => ({
      inn: c.inn,
      name: c.name,
      contact: c.contact,
      phone: c.phone,
      email: c.email,
      site: c.site
    }))
  };

  await copyJson(payload);
}

async function emailCopy() {
  const list = getSelectedCompanies();
  if (list.length === 0) return toast("Ничего не выбрано");

  const subject = ($("#email-subject")?.value || "").trim();
  const body = ($("#email-text")?.value || "").trim();

  const payload = {
    channel: "email",
    subject,
    body_template: body,
    recipients: list.map(c => ({
      inn: c.inn,
      name: c.name,
      email: c.email,
      contact: c.contact
    }))
  };

  await copyJson(payload);
}

async function pricelistCopy() {
  const list = getSelectedCompanies();
  if (list.length === 0) return toast("Ничего не выбрано");

  const type = ($("#pricelist-type")?.value || "general").trim();
  const note = ($("#pricelist-note")?.value || "").trim();

  const payload = {
    action: "send_pricelist",
    pricelist_type: type,
    note,
    recipients: list.map(c => ({
      inn: c.inn,
      name: c.name,
      email: c.email,
      phone: c.phone,
      contact: c.contact
    }))
  };

  await copyJson(payload);
}

// ========= modals =========
function openSettings() {
  buildRingSettingsUI();

  $("#cfg-api-url").value = config.apiUrl;
  $("#cfg-default-max").value = String(config.defaultMax);
  $("#cfg-enrich").value = String(Boolean(config.enrichWithRusprofile));

  $("#cfg-a-min").value = String(config.priority.aMinM);
  $("#cfg-b-min").value = String(config.priority.bMinM);

  $("#settings-modal").classList.remove("is-hidden");
}

function closeSettings() {
  $("#settings-modal").classList.add("is-hidden");
}

function buildRingSettingsUI() {
  const wrap = $("#ring-settings");
  wrap.innerHTML = "";

  for (let i = 1; i <= 5; i++) {
    const r = config.rings[i];

    const box = document.createElement("div");
    box.className = "ring-row";
    box.innerHTML = `
      <p class="ring-row__title">Кольцо ${i}</p>
      <div class="ring-row__grid">
        <div class="field">
          <label>От</label>
          <input type="text" data-ring-field="fromKm" data-ring="${i}" value="${r.fromKm}">
        </div>
        <div class="field">
          <label>До</label>
          <input type="text" data-ring-field="toKm" data-ring="${i}" value="${r.toKm}">
        </div>
        <div class="field">
          <label>Кол-во</label>
          <input type="text" data-ring-field="max" data-ring="${i}" value="${r.max}">
        </div>
      </div>
    `;
    wrap.appendChild(box);
  }
}

function resetConfig() {
  config = structuredClone(DEFAULT_CONFIG);
  saveConfig();
  applyConfigLabels();
  toast("Сброшено");
  openSettings();
}

function saveConfigFromUI() {
  const apiUrl = $("#cfg-api-url").value.trim();
  const defMax = Number($("#cfg-default-max").value.trim()) || 20;
  const enrich = $("#cfg-enrich").value === "true";

  const aMinM = Number($("#cfg-a-min").value.trim()) || 100;
  const bMinM = Number($("#cfg-b-min").value.trim()) || 10;

  config.apiUrl = apiUrl || DEFAULT_CONFIG.apiUrl;
  config.defaultMax = defMax;
  config.enrichWithRusprofile = enrich;
  config.priority.aMinM = aMinM;
  config.priority.bMinM = bMinM;

  $all("[data-ring-field]").forEach(inp => {
    const ring = Number(inp.dataset.ring);
    const field = inp.dataset.ringField;
    const val = Number(inp.value.trim());

    if (!config.rings[ring]) return;
    if (Number.isFinite(val)) config.rings[ring][field] = val;
  });

  saveConfig();
  applyConfigLabels();
  toast("Сохранено");
  closeSettings();

  // пересчитать приоритеты если уже есть данные
  if (companies.length) {
    companies = companies.map(c => {
      const pr = priorityFromRevenue(c.revenueRub);
      return { ...c, priority: pr };
    });
    applyFilters();
    renderRecent();
    renderStatsAll();
  }
}

function openDetails(company) {
  const modal = $("#details-modal");
  const pre = $("#details-pre");
  pre.textContent = JSON.stringify(company.raw || company, null, 2);
  modal.classList.remove("is-hidden");
}
function closeDetails() {
  $("#details-modal").classList.add("is-hidden");
}

// ========= init =========
function bindUI() {
  // date
  const d = $("#today-date");
  if (d) d.textContent = formatDateRu(new Date());

  // nav buttons
  $all("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.nav));
  });

  // ring buttons
  $all("[data-ring]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ringNum = Number(btn.dataset.ring);
      await runRing(ringNum);
    });
  });

  // search
  $("#btn-search").addEventListener("click", runTextSearch);
  $("#filter-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runTextSearch();
  });

  // filters events
  ["#filter-region","#filter-ring","#filter-priority","#filter-okved","#filter-contacts","#filter-search"]
    .forEach(sel => $(sel).addEventListener("input", applyFilters));

  $("#btn-clear-filters").addEventListener("click", () => {
    clearFiltersOnly();
    $("#filter-search").value = "";
    applyFilters();
  });

  // select all
  $("#select-all-cb").addEventListener("change", (e) => selectAllFiltered(e.target.checked));
  $("#btn-select-all").addEventListener("click", () => {
    selectAllAll();
    const cb = $("#select-all-cb");
    if (cb) cb.checked = true;
  });

  // export
  $("#btn-export").addEventListener("click", exportCsv);

  // enrich
  $("#btn-enrich-selected").addEventListener("click", enrichSelected);

  // selection reset
  $("#btn-clear-selection").addEventListener("click", clearSelection);

  // payload buttons
  $("#btn-tg-copy").addEventListener("click", telegramCopy);
  $("#btn-email-copy").addEventListener("click", emailCopy);
  $("#btn-pricelist-copy").addEventListener("click", pricelistCopy);

  // settings
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-save-config").addEventListener("click", saveConfigFromUI);
  $("#btn-reset-config").addEventListener("click", resetConfig);
  $all("[data-close-modal]").forEach(x => x.addEventListener("click", closeSettings));

  // details modal close
  $all("[data-close-details]").forEach(x => x.addEventListener("click", closeDetails));
}

document.addEventListener("DOMContentLoaded", () => {
  applyConfigLabels();
  bindUI();
  filteredCompanies = companies.slice();
  renderCompaniesTable(filteredCompanies);
  renderRecent();
  renderStatsAll();
  updateSelectedUI();
});
