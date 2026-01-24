// ============================================
// СтройПарсер v2.0 - Company Finder Dashboard
// ============================================

// ============================================
// 1. CONFIGURATION MANAGEMENT
// ============================================

const DEFAULT_CONFIG = {
  apiUrl: '',
  defaultMaxCompanies: 20,
  enrichRusprofile: true,
  priorityA: 100, // > 100M ₽ = Priority A
  priorityB: 10,  // 10-100M ₽ = Priority B, < 10M = Priority C
  rings: [
    { id: 1, label: 'Кольцо 1', minKm: 0, maxKm: 300, maxCompanies: 50, color: 'green' },
    { id: 2, label: 'Кольцо 2', minKm: 300, maxKm: 500, maxCompanies: 40, color: 'blue' },
    { id: 3, label: 'Кольцо 3', minKm: 500, maxKm: 700, maxCompanies: 30, color: 'yellow' },
    { id: 4, label: 'Кольцо 4', minKm: 700, maxKm: 1000, maxCompanies: 20, color: 'orange' },
    { id: 5, label: 'Кольцо 5', minKm: 1000, maxKm: 1500, maxCompanies: 10, color: 'red' }
  ]
};

function loadConfig() {
  try {
    const saved = localStorage.getItem('stroiparser_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config) {
  try {
    localStorage.setItem('stroiparser_config', JSON.stringify(config));
    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

function resetConfig() {
  localStorage.removeItem('stroiparser_config');
  return DEFAULT_CONFIG;
}

function validateConfig(config) {
  const errors = [];

  if (!config.apiUrl) {
    errors.push('API URL обязателен');
  } else if (!config.apiUrl.startsWith('http')) {
    errors.push('API URL должен начинаться с http:// или https://');
  }

  if (config.priorityA <= config.priorityB) {
    errors.push('Порог A должен быть больше порога B');
  }

  if (config.defaultMaxCompanies < 1 || config.defaultMaxCompanies > 100) {
    errors.push('Количество компаний должно быть от 1 до 100');
  }

  return errors;
}

// ============================================
// 2. STATE MANAGEMENT
// ============================================

const state = {
  companies: [],
  selectedIds: new Set(),
  currentView: 'dashboard',
  filters: {
    search: '',
    region: '',
    ring: '',
    priority: '',
    okved: '',
    contacts: ''
  },
  lastSearchQuery: '',
  isLoading: false,
  config: null
};

function addCompanies(newCompanies) {
  newCompanies.forEach(newCompany => {
    const existingIndex = state.companies.findIndex(c => c.inn === newCompany.inn);
    if (existingIndex >= 0) {
      state.companies[existingIndex] = { ...state.companies[existingIndex], ...newCompany };
    } else {
      state.companies.push(newCompany);
    }
  });
}

function getCompanyByInn(inn) {
  return state.companies.find(c => c.inn === inn);
}

function getSelectedCompanies() {
  return state.companies.filter(c => state.selectedIds.has(c.inn));
}

function getFilteredCompanies() {
  let filtered = [...state.companies];

  if (state.filters.region) {
    filtered = filtered.filter(c =>
      c.region?.includes(state.filters.region) ||
      c.legal_address?.includes(state.filters.region)
    );
  }

  if (state.filters.ring) {
    filtered = filtered.filter(c => c.ring === parseInt(state.filters.ring));
  }

  if (state.filters.priority) {
    filtered = filtered.filter(c => c.priority === state.filters.priority);
  }

  if (state.filters.okved) {
    filtered = filtered.filter(c =>
      c.okved_main?.startsWith(state.filters.okved)
    );
  }

  if (state.filters.contacts === 'phone') {
    filtered = filtered.filter(c => c.phones?.length > 0);
  } else if (state.filters.contacts === 'email') {
    filtered = filtered.filter(c => c.emails?.length > 0);
  } else if (state.filters.contacts === 'both') {
    filtered = filtered.filter(c =>
      c.phones?.length > 0 && c.emails?.length > 0
    );
  }

  return filtered;
}

function calculatePriority(revenueStr, config) {
  if (!revenueStr) return 'C';

  const numStr = revenueStr.replace(/[^0-9]/g, '');
  if (!numStr) return 'C';

  const millions = parseFloat(numStr) / 1000000;

  if (millions > config.priorityA) return 'A';
  if (millions >= config.priorityB) return 'B';
  return 'C';
}

function processCompanyData(company, config) {
  company.priority = calculatePriority(company.revenue, config);

  if (!company.region && company.legal_address) {
    const addressParts = company.legal_address.split(',');
    if (addressParts.length > 1) {
      company.region = addressParts[0].trim();
    }
  }

  return company;
}

// ============================================
// 3. API CLIENT
// ============================================

class CompanyFinderAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl ? baseUrl.replace(/\/$/, '') : '';
  }

  async request(endpoint, options = {}) {
    if (!this.baseUrl) {
      throw new Error('API URL не настроен');
    }

    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (response.status === 429) {
        const data = await response.json();
        const detail = data.detail || '';
        const waitTime = detail.match(/\d+/)?.[0] || 90;
        throw new Error(`RATE_LIMIT:${waitTime}`);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'TypeError') {
        throw new Error('Ошибка сети. Проверьте подключение к интернету');
      }
      throw error;
    }
  }

  async search(query, enrichWithRusprofile = true, maxCompanies = 10) {
    return await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        enrich_with_rusprofile: enrichWithRusprofile,
        max_companies: maxCompanies
      })
    });
  }

  async enrich(innList) {
    return await this.request('/enrich', {
      method: 'POST',
      body: JSON.stringify(innList)
    });
  }

  async healthCheck() {
    return await this.request('/health');
  }
}

// Global API instance
let API = null;

// ============================================
// 4. UI UTILITIES
// ============================================

function showLoading(text = 'Загрузка...') {
  const indicator = document.getElementById('running-indicator');
  if (indicator) {
    indicator.textContent = text;
    indicator.style.display = 'inline-block';
  }
  state.isLoading = true;
}

function hideLoading() {
  const indicator = document.getElementById('running-indicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
  state.isLoading = false;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;

  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast--visible'), 10);

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('is-hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
  }
}

// ============================================
// 5. NAVIGATION & VIEW MANAGEMENT
// ============================================

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('is-active');
  });

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('is-active');
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('nav-item--active');
    if (item.dataset.nav === viewName) {
      item.classList.add('nav-item--active');
    }
  });

  const titles = {
    dashboard: 'Панель управления',
    database: 'База клиентов',
    telegram: 'Telegram-рассылка',
    email: 'Email-рассылка',
    pricelist: 'Прайс-листы',
    stats: 'Статистика'
  };

  const titleElement = document.getElementById('page-title');
  if (titleElement) {
    titleElement.textContent = titles[viewName] || viewName;
  }

  state.currentView = viewName;

  if (viewName === 'stats') {
    renderStatistics();
  } else if (['telegram', 'email', 'pricelist'].includes(viewName)) {
    updateSelectedHints();
  } else if (viewName === 'dashboard') {
    updateDashboardStats();
    renderRecentTable();
  }
}

function updateRingLabels(config) {
  config.rings.forEach(ring => {
    const ringBtn = document.querySelector(`.tool-item[data-ring="${ring.id}"]`);
    if (ringBtn) {
      const count = state.companies.filter(c => c.ring === ring.id).length;
      const labelSpan = ringBtn.querySelector('.tool-item__label');
      if (labelSpan) {
        labelSpan.textContent = count > 0 ? `${ring.label} (${count})` : ring.label;
      }
    }
  });
}

// ============================================
// 6. TABLE RENDERING
// ============================================

function renderCompaniesTable() {
  const filtered = getFilteredCompanies();
  const tbody = document.getElementById('companies-table');

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align: center; padding: 40px; color: var(--text-muted);">
          Компании не найдены. Попробуйте изменить фильтры или выполнить поиск.
        </td>
      </tr>
    `;
    updateTableFooter(0);
    return;
  }

  tbody.innerHTML = filtered.map(company => renderTableRow(company)).join('');
  updateTableFooter(filtered.length);
  updateSelectionUI();
}

function renderTableRow(company) {
  const hasContact = (company.phones?.length > 0) || (company.emails?.length > 0);
  const contactIcon = hasContact ? '✓' : '—';

  return `
    <tr class="table-row" data-inn="${company.inn || ''}">
      <td class="cell--check">
        <input type="checkbox" class="company-checkbox" data-inn="${company.inn || ''}" ${state.selectedIds.has(company.inn) ? 'checked' : ''}>
      </td>
      <td class="cell--strong">${company.short_name || company.full_name || '—'}</td>
      <td class="cell--muted">${company.inn || '—'}</td>
      <td class="cell--muted">${company.legal_address || '—'}</td>
      <td>${company.okved_main ? `${company.okved_main} - ${company.okved_main_name || ''}` : '—'}</td>
      <td class="cell--strong">${company.revenue || '—'}</td>
      <td>
        <span class="priority priority--${(company.priority || 'c').toLowerCase()}">${company.priority || 'C'}</span>
      </td>
      <td class="cell--link">${company.phones?.[0] || '—'}</td>
      <td class="cell--link">${company.emails?.[0] || '—'}</td>
      <td class="cell--muted">${contactIcon}</td>
      <td class="cell--actions">
        <button class="btn btn--tiny btn--ghost btn-details" data-inn="${company.inn || ''}">
          Детали
        </button>
      </td>
    </tr>
  `;
}

function updateTableFooter(count) {
  const countElement = document.getElementById('companies-count');
  if (countElement) {
    countElement.textContent = `Показано ${count} компаний`;
  }

  const selectedElement = document.getElementById('selected-count');
  if (selectedElement) {
    selectedElement.textContent = `Выбрано: ${state.selectedIds.size}`;
  }
}

function renderRecentTable() {
  const recentTable = document.getElementById('recent-table');
  if (!recentTable) return;

  const recent = state.companies.slice(-5).reverse();

  if (recent.length === 0) {
    recentTable.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-muted);">
          Нет данных
        </td>
      </tr>
    `;
    return;
  }

  recentTable.innerHTML = recent.map(company => `
    <tr class="table-row">
      <td class="cell--strong">${company.short_name || company.full_name || '—'}</td>
      <td class="cell--muted">${company.inn || '—'}</td>
      <td>${company.region || '—'}</td>
      <td class="cell--strong">${company.revenue || '—'}</td>
      <td>
        <span class="priority priority--${(company.priority || 'c').toLowerCase()}">${company.priority || 'C'}</span>
      </td>
    </tr>
  `).join('');
}

// ============================================
// 7. SELECTION MANAGEMENT
// ============================================

function handleCheckboxChange(checkbox) {
  const inn = checkbox.dataset.inn;
  if (checkbox.checked) {
    state.selectedIds.add(inn);
  } else {
    state.selectedIds.delete(inn);
  }
  updateSelectionUI();
  updateDashboardStats();
}

function handleSelectAll(e) {
  const filtered = getFilteredCompanies();
  if (e.target.checked) {
    filtered.forEach(c => state.selectedIds.add(c.inn));
  } else {
    filtered.forEach(c => state.selectedIds.delete(c.inn));
  }
  updateSelectionUI();
}

function handleSelectAllButton() {
  const filtered = getFilteredCompanies();
  filtered.forEach(c => state.selectedIds.add(c.inn));
  updateSelectionUI();
  renderCompaniesTable();
}

function clearSelection() {
  state.selectedIds.clear();
  updateSelectionUI();
  renderCompaniesTable();
}

function updateSelectionUI() {
  document.querySelectorAll('.company-checkbox').forEach(cb => {
    cb.checked = state.selectedIds.has(cb.dataset.inn);
  });

  const metricElement = document.getElementById('metric-selected');
  if (metricElement) {
    metricElement.textContent = state.selectedIds.size;
  }

  updateTableFooter(getFilteredCompanies().length);
}

// ============================================
// 8. SEARCH & ENRICHMENT
// ============================================

async function handleSearch() {
  const searchInput = document.getElementById('filter-search');
  if (!searchInput) return;

  const query = searchInput.value.trim();

  if (!query) {
    showToast('Введите поисковый запрос', 'error');
    searchInput.focus();
    return;
  }

  if (query.length < 3) {
    showToast('Запрос слишком короткий (минимум 3 символа)', 'error');
    return;
  }

  const config = loadConfig();

  if (!config.apiUrl) {
    showToast('API URL не настроен. Откройте Настройки', 'error');
    setTimeout(() => openModal('settings-modal'), 500);
    return;
  }

  try {
    showLoading('Поиск компаний...');

    const result = await API.search(
      query,
      config.enrichRusprofile,
      config.defaultMaxCompanies
    );

    if (!result.success) {
      throw new Error(result.error || 'Ошибка поиска');
    }

    if (result.count === 0) {
      showToast('Компании не найдены. Попробуйте изменить запрос', 'info');
      hideLoading();
      return;
    }

    const processedCompanies = result.companies.map(c => processCompanyData(c, config));
    addCompanies(processedCompanies);

    state.lastSearchQuery = query;

    renderCompaniesTable();
    updateDashboardStats();
    updateRingLabels(config);

    showToast(`Найдено ${result.count} компаний`, 'success');
    hideLoading();

  } catch (error) {
    hideLoading();

    if (error.message.startsWith('RATE_LIMIT:')) {
      const waitTime = error.message.split(':')[1];
      showToast(`Превышен лимит запросов. Подождите ${waitTime} секунд`, 'warning');
    } else {
      showToast(`Ошибка: ${error.message}`, 'error');
    }

    console.error('Search error:', error);
  }
}

async function handleEnrich() {
  if (state.selectedIds.size === 0) {
    showToast('Выберите хотя бы одну компанию', 'error');
    return;
  }

  const config = loadConfig();

  if (!config.apiUrl) {
    showToast('API URL не настроен', 'error');
    return;
  }

  try {
    showLoading('Обогащение данных...');

    const innList = Array.from(state.selectedIds);
    const result = await API.enrich(innList);

    if (!result.success) {
      throw new Error(result.error || 'Ошибка обогащения');
    }

    const processedCompanies = result.companies.map(c => processCompanyData(c, config));
    addCompanies(processedCompanies);

    renderCompaniesTable();
    updateDashboardStats();

    const failed = innList.length - result.count;
    if (failed > 0) {
      showToast(
        `Обогащено ${result.count} из ${innList.length} компаний. ${failed} не найдено`,
        'warning'
      );
    } else {
      showToast(`Обогащено ${result.count} компаний`, 'success');
    }

    hideLoading();

  } catch (error) {
    hideLoading();
    showToast(`Ошибка: ${error.message}`, 'error');
    console.error('Enrich error:', error);
  }
}

async function handleRingSearch(ringId) {
  const config = loadConfig();
  const ring = config.rings.find(r => r.id === ringId);

  if (!ring) return;

  const query = `Find ${ring.maxCompanies} construction companies within ${ring.minKm}-${ring.maxKm}km from Samara`;

  try {
    showLoading(`Поиск компаний: ${ring.label}...`);

    const result = await API.search(query, config.enrichRusprofile, ring.maxCompanies);

    if (!result.success) {
      throw new Error(result.error || 'Ошибка поиска');
    }

    const processedCompanies = result.companies.map(c => {
      c.ring = ring.id;
      return processCompanyData(c, config);
    });

    addCompanies(processedCompanies);

    renderCompaniesTable();
    updateDashboardStats();
    updateRingLabels(config);

    showToast(`${ring.label}: найдено ${result.count} компаний`, 'success');
    hideLoading();

    switchView('database');

  } catch (error) {
    hideLoading();

    if (error.message.startsWith('RATE_LIMIT:')) {
      const waitTime = error.message.split(':')[1];
      showToast(`Превышен лимит запросов. Подождите ${waitTime} секунд`, 'warning');
    } else {
      showToast(`Ошибка: ${error.message}`, 'error');
    }

    console.error('Ring search error:', error);
  }
}

// ============================================
// 9. FILTERING
// ============================================

function applyFilters() {
  renderCompaniesTable();
}

function clearFilters() {
  state.filters = {
    search: '',
    region: '',
    ring: '',
    priority: '',
    okved: '',
    contacts: ''
  };

  ['filter-region', 'filter-ring', 'filter-priority', 'filter-okved', 'filter-contacts'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });

  renderCompaniesTable();
  showToast('Фильтры очищены', 'info');
}

// ============================================
// 10. STATISTICS
// ============================================

function calculateStatistics() {
  const companies = state.companies;
  const config = loadConfig();

  const ringStats = config.rings.map(ring => {
    const count = companies.filter(c => c.ring === ring.id).length;
    return {
      label: ring.label,
      count: count,
      maxCompanies: ring.maxCompanies,
      percentage: ring.maxCompanies > 0 ? (count / ring.maxCompanies) * 100 : 0,
      color: ring.color
    };
  });

  const priorityStats = ['A', 'B', 'C'].map(priority => {
    const count = companies.filter(c => c.priority === priority).length;
    return {
      priority: priority,
      count: count,
      percentage: companies.length > 0 ? (count / companies.length) * 100 : 0
    };
  });

  return { ringStats, priorityStats };
}

function renderStatistics() {
  const { ringStats, priorityStats } = calculateStatistics();

  const ringStatsElement = document.getElementById('ring-stats');
  if (ringStatsElement) {
    ringStatsElement.innerHTML = ringStats.map(stat => `
      <div class="bar-row">
        <div class="bar-row__label">
          <span class="dot ring-color--${stat.color}"></span>
          <span>${stat.label}</span>
        </div>
        <div class="bar">
          <span class="bar__fill ring-color--${stat.color}"
                style="width: ${Math.min(stat.percentage, 100)}%"></span>
        </div>
        <div class="bar-row__value">${stat.count}</div>
      </div>
    `).join('');
  }

  const priorityStatsElement = document.getElementById('priority-stats');
  if (priorityStatsElement) {
    priorityStatsElement.innerHTML = priorityStats.map(stat => `
      <div class="bar-row">
        <div class="bar-row__label">
          <span class="priority priority--${stat.priority.toLowerCase()}">${stat.priority}</span>
        </div>
        <div class="bar">
          <span class="bar__fill priority--${stat.priority.toLowerCase()}"
                style="width: ${Math.min(stat.percentage, 100)}%"></span>
        </div>
        <div class="bar-row__value">${stat.count}</div>
      </div>
    `).join('');
  }
}

function updateDashboardStats() {
  const total = state.companies.length;
  const priorityA = state.companies.filter(c => c.priority === 'A').length;
  const priorityB = state.companies.filter(c => c.priority === 'B').length;
  const priorityC = state.companies.filter(c => c.priority === 'C').length;
  const withContact = state.companies.filter(c =>
    (c.phones?.length > 0) || (c.emails?.length > 0)
  ).length;

  const statElements = {
    'stat-total': total,
    'stat-a': priorityA,
    'stat-b': priorityB,
    'stat-c': priorityC,
    'stat-contact': withContact
  };

  Object.entries(statElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });

  const metricElements = {
    'metric-found': total,
    'metric-selected': state.selectedIds.size,
    'metric-email': state.companies.filter(c => c.emails?.length > 0).length,
    'metric-phone': state.companies.filter(c => c.phones?.length > 0).length
  };

  Object.entries(metricElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

// ============================================
// 11. BROADCAST PAYLOADS
// ============================================

function updateSelectedHints() {
  const selected = getSelectedCompanies();

  const tgHint = document.getElementById('tg-selected-hint');
  if (tgHint) {
    tgHint.textContent = `Выбрано: ${selected.length} компаний`;
  }

  const emailHint = document.getElementById('email-selected-hint');
  if (emailHint) {
    emailHint.textContent = `Выбрано: ${selected.length} компаний`;
  }

  const pricelistHint = document.getElementById('pricelist-selected-hint');
  if (pricelistHint) {
    pricelistHint.textContent = `Выбрано: ${selected.length} компаний`;
  }
}

function generateTelegramPayload() {
  const selected = getSelectedCompanies();
  const messageInput = document.getElementById('tg-text');
  const personalizeCheckbox = document.getElementById('tg-personalize');

  if (!messageInput) return '[]';

  const message = messageInput.value || '';
  const personalize = personalizeCheckbox ? personalizeCheckbox.checked : false;

  const payload = selected
    .filter(c => c.phones?.length > 0)
    .map(company => ({
      phone: company.phones[0],
      message: personalize && company.director_name
        ? `Здравствуйте, ${company.director_name}!\n\n${message}`
        : message,
      company_name: company.short_name || company.full_name,
      inn: company.inn
    }));

  return JSON.stringify(payload, null, 2);
}

function generateEmailPayload() {
  const selected = getSelectedCompanies();
  const subjectInput = document.getElementById('email-subject');
  const bodyInput = document.getElementById('email-text');

  if (!subjectInput || !bodyInput) return '[]';

  const subject = subjectInput.value || '';
  const body = bodyInput.value || '';

  const payload = selected
    .filter(c => c.emails?.length > 0)
    .map(company => ({
      to: company.emails[0],
      subject: subject,
      body: body,
      company: {
        name: company.short_name || company.full_name,
        inn: company.inn,
        director: company.director_name,
        phone: company.phones?.[0]
      }
    }));

  return JSON.stringify(payload, null, 2);
}

function generatePricelistPayload() {
  const selected = getSelectedCompanies();
  const typeSelect = document.getElementById('pricelist-type');
  const noteInput = document.getElementById('pricelist-note');

  if (!typeSelect || !noteInput) return '{}';

  const type = typeSelect.value || 'general';
  const note = noteInput.value || '';

  const payload = {
    type: type,
    note: note,
    recipients: selected.map(company => ({
      company_name: company.short_name || company.full_name,
      inn: company.inn,
      email: company.emails?.[0],
      phone: company.phones?.[0],
      contact_person: company.director_name
    }))
  };

  return JSON.stringify(payload, null, 2);
}

function handleTelegramPayload() {
  if (state.selectedIds.size === 0) {
    showToast('Выберите хотя бы одну компанию', 'error');
    return;
  }

  const payload = generateTelegramPayload();
  const payloadObj = JSON.parse(payload);

  if (payloadObj.length === 0) {
    showToast('У выбранных компаний нет телефонов', 'warning');
    return;
  }

  copyToClipboard(payload)
    .then(() => showToast(`Payload скопирован (${payloadObj.length} контактов)`, 'success'))
    .catch(() => showToast('Ошибка копирования', 'error'));
}

function handleEmailPayload() {
  if (state.selectedIds.size === 0) {
    showToast('Выберите хотя бы одну компанию', 'error');
    return;
  }

  const payload = generateEmailPayload();
  const payloadObj = JSON.parse(payload);

  if (payloadObj.length === 0) {
    showToast('У выбранных компаний нет email', 'warning');
    return;
  }

  copyToClipboard(payload)
    .then(() => showToast(`Payload скопирован (${payloadObj.length} контактов)`, 'success'))
    .catch(() => showToast('Ошибка копирования', 'error'));
}

function handlePricelistPayload() {
  if (state.selectedIds.size === 0) {
    showToast('Выберите хотя бы одну компанию', 'error');
    return;
  }

  const payload = generatePricelistPayload();

  copyToClipboard(payload)
    .then(() => showToast('Payload скопирован', 'success'))
    .catch(() => showToast('Ошибка копирования', 'error'));
}

// ============================================
// 12. CSV EXPORT
// ============================================

function exportToCSV() {
  const companies = getFilteredCompanies();

  if (companies.length === 0) {
    showToast('Нет данных для экспорта', 'warning');
    return;
  }

  const headers = [
    'INN', 'Название', 'Статус', 'Регион', 'Адрес',
    'ОКВЭД', 'Оборот', 'Сотрудников', 'Приоритет',
    'Телефон', 'Email', 'Сайт', 'Директор', 'Дата регистрации'
  ];

  const rows = companies.map(c => [
    c.inn || '',
    c.short_name || c.full_name || '',
    c.status || '',
    c.region || '',
    c.legal_address || '',
    c.okved_main ? `${c.okved_main} - ${c.okved_main_name || ''}` : '',
    c.revenue || '',
    c.employees_count || '',
    c.priority || '',
    c.phones?.join('; ') || '',
    c.emails?.join('; ') || '',
    c.website || '',
    c.director_name || '',
    c.registration_date || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `companies_export_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  showToast(`Экспортировано ${companies.length} компаний`, 'success');
}

// ============================================
// 13. SETTINGS MODAL
// ============================================

function populateSettingsModal() {
  const config = loadConfig();

  const apiUrlInput = document.getElementById('cfg-api-url');
  const defaultMaxInput = document.getElementById('cfg-default-max');
  const enrichSelect = document.getElementById('cfg-enrich');
  const priorityAInput = document.getElementById('cfg-a-min');
  const priorityBInput = document.getElementById('cfg-b-min');

  if (apiUrlInput) apiUrlInput.value = config.apiUrl;
  if (defaultMaxInput) defaultMaxInput.value = config.defaultMaxCompanies;
  if (enrichSelect) enrichSelect.value = config.enrichRusprofile.toString();
  if (priorityAInput) priorityAInput.value = config.priorityA;
  if (priorityBInput) priorityBInput.value = config.priorityB;

  const ringSettings = document.getElementById('ring-settings');
  if (ringSettings) {
    ringSettings.innerHTML = config.rings.map(ring => `
      <div class="ring-row">
        <p class="ring-row__title">${ring.label}</p>
        <div class="ring-row__grid">
          <div class="field">
            <label>От (км)</label>
            <input type="number" data-ring="${ring.id}" data-field="minKm" value="${ring.minKm}">
          </div>
          <div class="field">
            <label>До (км)</label>
            <input type="number" data-ring="${ring.id}" data-field="maxKm" value="${ring.maxKm}">
          </div>
          <div class="field">
            <label>Макс</label>
            <input type="number" data-ring="${ring.id}" data-field="maxCompanies" value="${ring.maxCompanies}">
          </div>
        </div>
      </div>
    `).join('');
  }
}

function handleSaveConfig() {
  const apiUrlInput = document.getElementById('cfg-api-url');
  const defaultMaxInput = document.getElementById('cfg-default-max');
  const enrichSelect = document.getElementById('cfg-enrich');
  const priorityAInput = document.getElementById('cfg-a-min');
  const priorityBInput = document.getElementById('cfg-b-min');

  if (!apiUrlInput || !defaultMaxInput || !enrichSelect || !priorityAInput || !priorityBInput) {
    showToast('Ошибка: не все поля найдены', 'error');
    return;
  }

  const config = {
    apiUrl: apiUrlInput.value.trim(),
    defaultMaxCompanies: parseInt(defaultMaxInput.value),
    enrichRusprofile: enrichSelect.value === 'true',
    priorityA: parseFloat(priorityAInput.value),
    priorityB: parseFloat(priorityBInput.value),
    rings: loadConfig().rings
  };

  document.querySelectorAll('#ring-settings input').forEach(input => {
    const ringId = parseInt(input.dataset.ring);
    const field = input.dataset.field;
    const ring = config.rings.find(r => r.id === ringId);
    if (ring) {
      const value = input.value;
      ring[field] = (field === 'maxCompanies') ? parseInt(value) : parseFloat(value);
    }
  });

  const errors = validateConfig(config);
  if (errors.length > 0) {
    showToast(`Ошибка: ${errors.join(', ')}`, 'error');
    return;
  }

  if (saveConfig(config)) {
    state.config = config;
    API = new CompanyFinderAPI(config.apiUrl);
    updateRingLabels(config);
    showToast('Настройки сохранены', 'success');
    closeModal('settings-modal');
  } else {
    showToast('Ошибка сохранения настроек', 'error');
  }
}

function handleResetConfig() {
  if (confirm('Сбросить все настройки к значениям по умолчанию?')) {
    const config = resetConfig();
    populateSettingsModal();
    showToast('Настройки сброшены', 'info');
  }
}

// ============================================
// 14. DETAILS MODAL
// ============================================

function showCompanyDetails(inn) {
  const company = getCompanyByInn(inn);

  if (!company) {
    showToast('Компания не найдена', 'error');
    return;
  }

  const detailsPre = document.getElementById('details-pre');
  if (detailsPre) {
    detailsPre.textContent = JSON.stringify(company, null, 2);
  }

  openModal('details-modal');
}

// ============================================
// 15. EVENT BINDING
// ============================================

function bindEvents() {
  const btnSearch = document.getElementById('btn-search');
  if (btnSearch) {
    btnSearch.addEventListener('click', handleSearch);
  }

  const filterSearch = document.getElementById('filter-search');
  if (filterSearch) {
    filterSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }

  ['filter-region', 'filter-ring', 'filter-priority', 'filter-okved', 'filter-contacts'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('change', (e) => {
        const filterKey = id.replace('filter-', '');
        state.filters[filterKey] = e.target.value;
        renderCompaniesTable();
      });
    }
  });

  const btnClearFilters = document.getElementById('btn-clear-filters');
  if (btnClearFilters) {
    btnClearFilters.addEventListener('click', clearFilters);
  }

  const selectAllCb = document.getElementById('select-all-cb');
  if (selectAllCb) {
    selectAllCb.addEventListener('change', handleSelectAll);
  }

  const btnSelectAll = document.getElementById('btn-select-all');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', handleSelectAllButton);
  }

  const btnClearSelection = document.getElementById('btn-clear-selection');
  if (btnClearSelection) {
    btnClearSelection.addEventListener('click', clearSelection);
  }

  const btnEnrich = document.getElementById('btn-enrich-selected');
  if (btnEnrich) {
    btnEnrich.addEventListener('click', handleEnrich);
  }

  document.querySelectorAll('.tool-item[data-ring]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const ringId = parseInt(e.currentTarget.dataset.ring);
      handleRingSearch(ringId);
    });
  });

  const btnTgCopy = document.getElementById('btn-tg-copy');
  if (btnTgCopy) {
    btnTgCopy.addEventListener('click', handleTelegramPayload);
  }

  const btnEmailCopy = document.getElementById('btn-email-copy');
  if (btnEmailCopy) {
    btnEmailCopy.addEventListener('click', handleEmailPayload);
  }

  const btnPricelistCopy = document.getElementById('btn-pricelist-copy');
  if (btnPricelistCopy) {
    btnPricelistCopy.addEventListener('click', handlePricelistPayload);
  }

  const btnExport = document.getElementById('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', exportToCSV);
  }

  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', () => {
      populateSettingsModal();
      openModal('settings-modal');
    });
  }

  const btnSaveConfig = document.getElementById('btn-save-config');
  if (btnSaveConfig) {
    btnSaveConfig.addEventListener('click', handleSaveConfig);
  }

  const btnResetConfig = document.getElementById('btn-reset-config');
  if (btnResetConfig) {
    btnResetConfig.addEventListener('click', handleResetConfig);
  }

  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('company-checkbox')) {
      handleCheckboxChange(e.target);
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-details')) {
      const inn = e.target.dataset.inn;
      showCompanyDetails(inn);
    }

    const navTrigger = e.target.closest('[data-nav]');
    if (navTrigger) {
      const viewName = navTrigger.dataset.nav;
      switchView(viewName);
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal('settings-modal'));
  });

  document.querySelectorAll('[data-close-details]').forEach(btn => {
    btn.addEventListener('click', () => closeModal('details-modal'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('settings-modal');
      closeModal('details-modal');
    }
  });
}

// ============================================
// 16. INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('СтройПарсер v2.0 initializing...');

  const config = loadConfig();
  state.config = config;
  API = new CompanyFinderAPI(config.apiUrl);

  const todayDate = document.getElementById('today-date');
  if (todayDate) {
    todayDate.textContent = new Date().toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  if (config.apiUrl) {
    try {
      const health = await API.healthCheck();
      console.log('API health:', health);

      if (health.status === 'healthy') {
        showToast('API подключен', 'success');
      } else {
        showToast('API доступен, но есть проблемы с конфигурацией', 'warning');
      }
    } catch (error) {
      console.warn('API не доступен:', error);
      showToast('API не доступен. Проверьте настройки', 'warning');
    }
  } else {
    showToast('Настройте API URL в настройках', 'info');
    setTimeout(() => openModal('settings-modal'), 1500);
  }

  updateRingLabels(config);
  renderCompaniesTable();
  renderStatistics();
  updateDashboardStats();
  renderRecentTable();

  bindEvents();

  console.log('СтройПарсер v2.0 ready!');
});
