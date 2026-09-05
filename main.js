/* ============================================================
   WikiAI v2 — catalog app
   Three banks: AI tools, MCP servers, agent skills.
   Vanilla JS, no dependencies. Data lives in /data/*.json.
   ============================================================ */

'use strict';

/* ---------- State ---------- */
const state = {
  tab: 'tools',
  data: { tools: [], mcps: [], skills: [] },
  search: '',
  category: '',
  secondary: '',
  favOnly: false,
  sort: 'relevance',
  page: 1,
  pageSize: 24,
  favs: loadFavs(),
  results: [],
};

const TAB_META = {
  tools: {
    label: 'Tools',
    dataKey: 'tools',
    categories: (d) => [...new Set(d.flatMap((t) => t.categories || []))].filter(Boolean).sort(),
    secondaryLabel: 'Pricing',
    secondaries: ['free', 'freemium', 'paid', 'open source', 'github'],
    secondaryValue: (t) => (t.pricing || '').toLowerCase(),
  },
  mcps: {
    label: 'MCP Servers',
    dataKey: 'mcps',
    categories: (d) => [...new Set(d.map((m) => m.category).filter(Boolean))].sort(),
    secondaryLabel: 'Transport',
    secondaries: ['stdio', 'http'],
    secondaryValue: (m) => (m.transports || []).join(' '),
  },
  skills: {
    label: 'Skills',
    dataKey: 'skills',
    categories: (d) => [...new Set(d.map((s) => s.category).filter(Boolean))].sort(),
    secondaryLabel: 'Difficulty',
    secondaries: ['easy', 'medium', 'advanced'],
    secondaryValue: (s) => s.difficulty || '',
  },
};

/* ---------- Logo rendering ---------- */
/* Logo for an entry: explicit logo URL, GitHub owner avatar for
   github.com/OWNER/... links, else the site favicon via Google's
   service. The <img> removes itself on error, revealing the
   letter-avatar fallback. */
function logoHtml(item) {
  let src = item.logo || '';
  if (!src) {
    const gh = (item.url || '').match(/github\.com\/([^/#?]+)/);
    if (gh) src = `https://github.com/${encodeURIComponent(gh[1])}.png`;
    else {
      const host = hostnameOf(item.url);
      if (host) src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    }
  }
  if (!src) return '';
  return `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}

function loadFavs() {
  try {
    return JSON.parse(localStorage.getItem('wikiai.favs')) || { tools: [], mcps: [], skills: [] };
  } catch {
    return { tools: [], mcps: [], skills: [] };
  }
}

function saveFavs() {
  localStorage.setItem('wikiai.favs', JSON.stringify(state.favs));
}

function isFav(item) {
  return state.favs[state.tab].includes(item.id);
}

function toggleFav(item) {
  const list = state.favs[state.tab];
  const i = list.indexOf(item.id);
  if (i >= 0) list.splice(i, 1);
  else list.push(item.id);
  saveFavs();
  render();
  toast(i >= 0 ? 'Removed from favorites' : 'Added to favorites');
}

/* ---------- Data loading ---------- */
function loadBank() {
  const key = TAB_META[state.tab].dataKey;
  if (state.data[key].length) {
    state.results = state.data[key];
    applyFilters();
    return;
  }
  fetch(`data/${key}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then((data) => {
      state.data[key] = data;
      state.results = data;
      renderChrome();
      applyFilters();
    })
    .catch(() => {
      $('#result-meta').textContent = 'Failed to load catalog data.';
    });
}

/* ---------- Filtering ---------- */
function matchesSearch(item, q) {
  if (!q) return true;
  const hay = [
    item.name,
    item.short,
    item.description,
    item.category,
    item.publisher,
    item.pricing,
    (item.tags || []).join(' '),
    (item.categories || []).join(' '),
    (item.transports || []).join(' '),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function applyFilters() {
  const meta = TAB_META[state.tab];
  const q = state.search.trim().toLowerCase();
  const secondaries = state.secondary ? state.secondary.split(',') : null;

  let list = state.data[meta.dataKey].filter((item) => {
    if (!matchesSearch(item, q)) return false;
    if (state.category && !(item.categories || []).includes(state.category) && item.category !== state.category) return false;
    if (secondaries && !secondaries.some((s) => meta.secondaryValue(item).split(/[\s,/]+/).includes(s))) return false;
    if (state.favOnly && !isFav(item)) return false;
    return true;
  });

  // Sort
  if (state.sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  else if (state.sort === 'newest') list.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  else if (state.sort === 'relevance' && !q) {
    // Trending + recently updated first
    list.sort((a, b) => {
      if (!!b.trending !== !!a.trending) return b.trending ? 1 : -1;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  }

  state.results = list;
  state.page = 1;
  render();
}

function onFilterChange() {
  state.category = $('#category-select').value;
  state.secondary = $('#secondary-select').value;
  state.sort = $('#sort-select').value;
  applyFilters();
}

function resetFilters() {
  state.search = '';
  state.category = '';
  state.secondary = '';
  state.favOnly = false;
  state.sort = 'relevance';
  $('#search-input').value = '';
  $('#category-select').value = '';
  $('#secondary-select').value = '';
  $('#sort-select').value = 'relevance';
  updateFavButton();
  applyFilters();
}

/* ---------- Rendering ---------- */
function renderChrome() {
  // Tab counts
  for (const [key, meta] of Object.entries(TAB_META)) {
    const el = $(`#tab-count-${key}`);
    if (el) el.textContent = state.data[meta.dataKey].length.toLocaleString();
  }
  // Hero stats
  const stats = $('#hero-stats');
  stats.innerHTML = [
    ['AI Tools', state.data.tools.length],
    ['MCP Servers', state.data.mcps.length],
    ['Agent Skills', state.data.skills.length],
    ['Categories', new Set([...state.data.tools.flatMap((t) => t.categories || []), ...state.data.mcps.map((m) => m.category), ...state.data.skills.map((s) => s.category)].filter(Boolean)).size],
  ]
    .map(([k, v]) => `<span class="stat-chip"><strong>${v.toLocaleString()}</strong> ${k}</span>`)
    .join('');
  populateFilters();
}

function populateFilters() {
  const meta = TAB_META[state.tab];
  const catSel = $('#category-select');
  const secSel = $('#secondary-select');

  const cats = meta.categories(state.data[meta.dataKey]);
  catSel.innerHTML = `<option value="">All categories</option>` + cats.map((c) => `<option value="${esc(c)}">${esc(c)} (${countCat(c)})</option>`).join('');
  catSel.value = state.category;

  secSel.innerHTML = `<option value="">All ${meta.secondaryLabel}</option>` + meta.secondaries.map((s) => `<option value="${s}">${esc(s)}</option>`).join('');
  secSel.value = state.secondary;
}

function countCat(cat) {
  const meta = TAB_META[state.tab];
  return state.data[meta.dataKey].filter((x) => (x.categories || []).includes(cat) || x.category === cat).length;
}

function cardHtml(item) {
  const meta = TAB_META[state.tab];
  const sub = meta.dataKey === 'tools' ? hostnameOf(item.url) : item.publisher || hostnameOf(item.url);
  const badge =
    meta.dataKey === 'tools'
      ? pricingBadge(item.pricing)
      : meta.dataKey === 'mcps'
        ? (item.official ? `<span class="badge badge-official">Official</span>` : `<span class="badge badge-tag">Community</span>`) + `<span class="badge badge-cat">${esc((item.transports || []).join(' · '))}</span>`
        : `<span class="badge badge-cat">${esc(item.difficulty)}</span>`;
  const cats = (item.categories || []).slice(0, 3).map((c) => `<span class="badge badge-cat">${esc(c)}</span>`).join('');

  return `
  <article class="card">
    <div class="card-top">
      <div class="card-logo" aria-hidden="true">${esc(initials(item.name))}${logoHtml(item)}</div>
      <div class="card-title">
        <h3><a href="${esc(item.url || '#')}" target="_blank" rel="noopener">${esc(item.name)}</a></h3>
        <div class="sub">${esc(sub)}</div>
      </div>
      <button class="fav-btn ${isFav(item) ? 'on' : ''}" data-action="fav" data-id="${esc(item.id)}" title="Favorite" aria-label="Toggle favorite">
        <svg fill="${isFav(item) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21C7 16.5 2 13 2 8.5 2 5.5 4.5 3 7.5 3c1.7 0 3.3.8 4.5 2.2C13.2 3.8 14.8 3 16.5 3 19.5 3 22 5.5 22 8.5c0 4.5-5 8-10 12.5z"/></svg>
      </button>
    </div>
    <p class="card-desc">${esc(item.short || item.description || '')}</p>
    <div class="card-bottom">
      ${badge}
      ${cats}
      <button class="card-detail-btn" data-action="detail" data-id="${esc(item.id)}">Details</button>
      <a class="card-link" href="${esc(item.url || '#')}" target="_blank" rel="noopener">Open ↗</a>
    </div>
  </article>`;
}

function pricingBadge(pricing) {
  const p = String(pricing || 'unknown').toLowerCase();
  const map = {
    free: ['badge-free', 'Free'],
    github: ['badge-open', 'Open Source'],
    'open source': ['badge-open', 'Open Source'],
    freemium: ['badge-freemium', 'Freemium'],
    paid: ['badge-paid', 'Paid'],
    'google colab': ['badge-free', 'Colab'],
  };
  if (map[p]) return `<span class="badge ${map[p][0]}">${map[p][1]}</span>`;
  return `<span class="badge badge-unknown">${esc(pricing || 'Unknown')}</span>`;
}

function render() {
  const meta = TAB_META[state.tab];
  const grid = $('#grid');
  const total = state.results.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.pageSize;
  const slice = state.results.slice(start, start + state.pageSize);

  grid.innerHTML = slice.map(cardHtml).join('');
  $('#result-meta').textContent = total
    ? `${total.toLocaleString()} ${meta.label.toLowerCase()} · page ${state.page} of ${pages}`
    : '';

  renderPagination(pages);
  $('#empty-state').classList.toggle('hidden', total > 0);
  $('#pagination').classList.toggle('hidden', pages <= 1);
}

function renderPagination(pages) {
  const el = $('#pagination');
  if (pages <= 1) {
    el.innerHTML = '';
    return;
  }
  const win = [];
  const start = Math.max(1, state.page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i++) win.push(i);

  let html = `<button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>‹ Prev</button>`;
  if (start > 1) html += `<button data-page="1">1</button>${start > 2 ? '<span class="muted">…</span>' : ''}`;
  for (const p of win) html += `<button data-page="${p}" class="${p === state.page ? 'active' : ''}">${p}</button>`;
  if (end < pages) html += `${end < pages - 1 ? '<span class="muted">…</span>' : ''}<button data-page="${pages}">${pages}</button>`;
  html += `<button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''}>Next ›</button>`;
  el.innerHTML = html;
}

/* ---------- Detail modal ---------- */
function openDetail(item) {
  const meta = TAB_META[state.tab];
  const content = $('#detail-content');
  const chips = (item.tags || []).map((t) => `<span class="badge badge-tag">${esc(t)}</span>`).join('');

  let metaGrid = '';
  if (meta.dataKey === 'tools') {
    metaGrid = `
      <div class="meta-item"><div class="k">Pricing</div><div class="v">${pricingBadge(item.pricing)}</div></div>
      <div class="meta-item"><div class="k">Website</div><div class="v"><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(hostnameOf(item.url))}</a></div></div>
      ${item.updated_at ? `<div class="meta-item"><div class="k">Updated</div><div class="v">${esc(item.updated_at)}</div></div>` : ''}
      ${item.lang_support && item.lang_support.length ? `<div class="meta-item"><div class="k">Languages</div><div class="v">${esc(item.lang_support.join(', '))}</div></div>` : ''}`;
  } else if (meta.dataKey === 'mcps') {
    metaGrid = `
      <div class="meta-item"><div class="k">Category</div><div class="v">${esc(item.category || '—')}</div></div>
      <div class="meta-item"><div class="k">Transport</div><div class="v">${esc((item.transports || []).join(' / '))}</div></div>
      <div class="meta-item"><div class="k">Auth</div><div class="v">${esc(item.auth || '—')}</div></div>
      <div class="meta-item"><div class="k">Publisher</div><div class="v">${esc(item.publisher || '—')}</div></div>`;
  } else {
    metaGrid = `
      <div class="meta-item"><div class="k">Category</div><div class="v">${esc(item.category || '—')}</div></div>
      <div class="meta-item"><div class="k">Difficulty</div><div class="v">${esc(item.difficulty || '—')}</div></div>
      <div class="meta-item"><div class="k">Input</div><div class="v">${esc(item.input || '—')}</div></div>
      <div class="meta-item"><div class="k">Output</div><div class="v">${esc(item.output || '—')}</div></div>`;
  }

  const installBlock =
    meta.dataKey === 'mcps' && item.install
      ? `<div class="modal-section"><h4>Quick install</h4><pre class="mcp-install">${esc(item.install)}</pre></div>`
      : '';

  content.innerHTML = `
    <div class="modal-head">
      <div class="modal-logo" aria-hidden="true">${esc(initials(item.name))}${logoHtml(item)}</div>
      <div>
        <h2>${esc(item.name)}</h2>
        <div class="modal-url">${esc(item.url ? hostnameOf(item.url) : '')}</div>
      </div>
    </div>
    <div class="modal-body">
      <p class="desc">${esc(item.description || item.short || '')}</p>
      <div class="meta-grid">${metaGrid}</div>
      ${item.categories && item.categories.length ? `<div class="modal-section"><h4>Categories</h4><div class="chips">${item.categories.map((c) => `<span class="badge badge-cat">${esc(c)}</span>`).join('')}</div></div>` : ''}
      ${chips ? `<div class="modal-section"><h4>Tags</h4><div class="chips">${chips}</div></div>` : ''}
      ${installBlock}
    </div>
    <div class="modal-actions">
      <a class="btn btn-accent" href="${esc(item.url || '#')}" target="_blank" rel="noopener">Open ↗</a>
      <button class="btn btn-ghost" data-action="modal-fav" data-id="${esc(item.id)}">${isFav(item) ? '★ Favorited' : '☆ Add to favorites'}</button>
    </div>`;

  $('#detail-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('#detail-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ---------- Tabs ---------- */
function setTab(tab) {
  state.tab = tab;
  state.search = '';
  state.category = '';
  state.secondary = '';
  state.favOnly = false;
  state.sort = 'relevance';
  state.page = 1;
  $('#search-input').value = '';
  $('#sort-select').value = 'relevance';
  updateFavButton();

  document.querySelectorAll('.header-tabs button').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#search-input').placeholder = `Search ${TAB_META[tab].label.toLowerCase()}…`;
  loadBank();
}

function updateFavButton() {
  const btn = $('#favorite-toggle');
  btn.classList.toggle('on', state.favOnly);
  $('#favorite-label').textContent = state.favOnly ? 'Favorites only' : 'Favorites';
}

/* ---------- Theme ---------- */
function initTheme() {
  const toggle = $('#theme-toggle');
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    $('#icon-sun').classList.toggle('hidden', dark);
    $('#icon-moon').classList.toggle('hidden', !dark);
  };
  sync();
  toggle.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    localStorage.setItem('wikiai.theme', dark ? 'light' : 'dark');
    sync();
  });
}

/* ---------- Events ---------- */
function bindEvents() {
  document.querySelectorAll('.header-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  let debounce;
  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.search = e.target.value;
      applyFilters();
    }, 150);
  });

  ['#category-select', '#secondary-select', '#sort-select'].forEach((sel) =>
    $(sel).addEventListener('change', onFilterChange)
  );

  $('#favorite-toggle').addEventListener('click', () => {
    state.favOnly = !state.favOnly;
    updateFavButton();
    applyFilters();
  });

  $('#reset-filters').addEventListener('click', resetFilters);
  $('#reset-button').addEventListener('click', resetFilters);

  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const item = state.results.find((x) => x.id === id);
    if (!item) return;
    if (btn.dataset.action === 'fav') toggleFav(item);
    if (btn.dataset.action === 'detail') openDetail(item);
  });

  $('#pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#detail-close').addEventListener('click', closeDetail);
  $('#detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDetail();
  });

  $('#detail-content').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="modal-fav"]');
    if (!btn) return;
    const item = state.results.find((x) => x.id === btn.dataset.id);
    if (item) toggleFav(item);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initTheme();
  setTab('tools');
});