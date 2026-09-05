/* WikiAI v2 admin — manage Tools / MCPs / Skills banks.
   Data model: seed (data/<bank>.json) + custom entries (localStorage) − deleted ids. */

'use strict';

const state = {
  bank: 'tools',
  seed: [],
  custom: [],
  deleted: [],
  editingId: null,
};

const BANK_FIELDS = {
  tools: {
    label: 'Tools',
    extra: `
      <div>
        <label>Pricing</label>
        <select id="f-pricing">
          <option value="free">Free</option>
          <option value="freemium">Freemium</option>
          <option value="paid">Paid</option>
          <option value="open source">Open Source</option>
          <option value="github">GitHub</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div>
        <label>Categories (comma separated)</label>
        <input id="f-categories" placeholder="Productivity, Chat">
      </div>`,
    fromForm: (b) => ({
      ...b,
      pricing: $('#f-pricing').value,
      categories: $('#f-categories').value.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    toForm: (item) => {
      $('#f-pricing').value = item.pricing || 'unknown';
      $('#f-categories').value = (item.categories || []).join(', ');
    },
    badge: (item) => item.pricing || '',
    cat: (item) => (item.categories || []).join(', '),
  },
  mcps: {
    label: 'MCP Servers',
    extra: `
      <div>
        <label>Category</label>
        <input id="f-mcp-category" placeholder="Developer Tools">
      </div>
      <div>
        <label>Transports (comma separated)</label>
        <input id="f-transports" placeholder="stdio, http">
      </div>
      <div>
        <label>Auth</label>
        <input id="f-auth" placeholder="API key">
      </div>
      <div>
        <label>Publisher</label>
        <input id="f-publisher" placeholder="Vendor or Community">
      </div>
      <div>
        <label>Official
          <select id="f-official" style="margin-top:4px">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>
      <div class="full">
        <label>Install hint</label>
        <input id="f-install" placeholder="npx -y package">
      </div>`,
    fromForm: (b) => ({
      ...b,
      category: $('#f-mcp-category').value,
      transports: $('#f-transports').value.split(',').map((s) => s.trim()).filter(Boolean),
      auth: $('#f-auth').value,
      publisher: $('#f-publisher').value,
      official: $('#f-official').value === 'true',
      install: $('#f-install').value,
    }),
    toForm: (item) => {
      $('#f-mcp-category').value = item.category || '';
      $('#f-transports').value = (item.transports || []).join(', ');
      $('#f-auth').value = item.auth || '';
      $('#f-publisher').value = item.publisher || '';
      $('#f-official').value = String(!!item.official);
      $('#f-install').value = item.install || '';
    },
    badge: (item) => (item.official ? 'Official' : 'Community'),
    cat: (item) => item.category || '',
  },
  skills: {
    label: 'Skills',
    extra: `
      <div>
        <label>Category</label>
        <input id="f-skill-category" placeholder="Writing & Content">
      </div>
      <div>
        <label>Difficulty</label>
        <select id="f-difficulty">
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>
      <div>
        <label>Input</label>
        <input id="f-input" placeholder="What it takes in">
      </div>
      <div>
        <label>Output</label>
        <input id="f-output" placeholder="What it produces">
      </div>
      <div>
        <label>Source</label>
        <input id="f-source" placeholder="anthropics/skills">
      </div>
      <div>
        <label>Reference URL</label>
        <input id="f-skill-url" placeholder="https://…">
      </div>`,
    fromForm: (b) => ({
      ...b,
      category: $('#f-skill-category').value,
      difficulty: $('#f-difficulty').value,
      input: $('#f-input').value,
      output: $('#f-output').value,
      source: $('#f-source').value,
      url: $('#f-skill-url').value || b.url,
    }),
    toForm: (item) => {
      $('#f-skill-category').value = item.category || '';
      $('#f-difficulty').value = item.difficulty || 'easy';
      $('#f-input').value = item.input || '';
      $('#f-output').value = item.output || '';
      $('#f-source').value = item.source || '';
      $('#f-skill-url').value = item.url || '';
    },
    badge: (item) => item.difficulty || '',
    cat: (item) => item.category || '',
  },
};

const KEY = () => `wikiai.admin.${state.bank}`;
const DEL_KEY = () => `wikiai.admin.${state.bank}.deleted`;

function load() {
  try {
    state.custom = JSON.parse(localStorage.getItem(KEY())) || [];
    state.deleted = JSON.parse(localStorage.getItem(DEL_KEY())) || [];
  } catch {
    state.custom = [];
    state.deleted = [];
  }
}

function save() {
  localStorage.setItem(KEY(), JSON.stringify(state.custom));
  localStorage.setItem(DEL_KEY(), JSON.stringify(state.deleted));
}

function merged() {
  const seed = state.seed.filter((x) => !state.deleted.includes(x.id));
  const custom = state.custom.filter((x) => !state.deleted.includes(x.id));
  const ids = new Set([...seed.map((x) => x.id), ...custom.map((x) => x.id)]);
  const byId = new Map([...seed, ...custom].map((x) => [x.id, x]));
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

function renderTable() {
  const list = merged();
  const query = (state.q || '').toLowerCase();
  const filtered = query ? list.filter((x) => JSON.stringify(x).toLowerCase().includes(query)) : list;
  const meta = BANK_FIELDS[state.bank];

  $('#row-count').textContent = `${list.length.toLocaleString()} entries (${state.custom.length} local)${query ? ` · ${filtered.length} matching` : ''}`;

  $('#table-body').innerHTML = filtered
    .slice(0, 500)
    .map(
      (item) => `
    <tr>
      <td style="font-weight:600">${esc(item.name)}${state.custom.some((c) => c.id === item.id) ? ' <span class="badge badge-official" style="font-size:10px">local</span>' : ''}</td>
      <td>${esc(meta.cat(item))}</td>
      <td><span class="badge badge-cat">${esc(meta.badge(item))}</span></td>
      <td><a href="${esc(item.url)}" target="_blank" rel="noopener">${esc((item.url || '').replace(/^https?:\/\//, '').slice(0, 40))}</a></td>
      <td>
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(item.id)}">Edit</button>
        <button class="btn btn-ghost btn-sm danger" data-action="delete" data-id="${esc(item.id)}">Del</button>
      </td>
    </tr>`
    )
    .join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No entries.</td></tr>';

  if (filtered.length > 500) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="5" class="muted" style="text-align:center;font-size:12px">Showing first 500 — narrow the search or export the full JSON.</td>`;
    $('#table-body').appendChild(row);
  }
}

function resetForm() {
  state.editingId = null;
  $('#entry-form').reset();
  $('#edit-hint').textContent = '';
  $('#form-title').textContent = 'Add entry';
  const meta = BANK_FIELDS[state.bank];
  meta.toForm({});
}

function editItem(id) {
  const item = merged().find((x) => x.id === id);
  if (!item) return;
  state.editingId = id;
  const meta = BANK_FIELDS[state.bank];
  $('#f-name').value = item.name || '';
  $('#f-slug').value = item.slug || '';
  $('#f-url').value = item.url || '';
  $('#f-short').value = item.short || '';
  $('#f-desc').value = item.description || '';
  $('#f-tags').value = (item.tags || []).join(', ');
  meta.toForm(item);
  $('#edit-hint').textContent = `Editing ${item.name}`;
  $('#form-title').textContent = 'Edit entry';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitForm(e) {
  e.preventDefault();
  const meta = BANK_FIELDS[state.bank];
  const base = {
    name: $('#f-name').value.trim(),
    slug: $('#f-slug').value.trim() || slugify($('#f-name').value),
    url: $('#f-url').value.trim(),
    short: $('#f-short').value.trim(),
    description: $('#f-desc').value.trim(),
    tags: $('#f-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
  };
  if (!base.name || !base.url) {
    toast('Name and URL are required');
    return;
  }
  const full = meta.fromForm(base);

  if (state.editingId) {
    const idx = state.custom.findIndex((c) => c.id === state.editingId);
    if (idx >= 0) state.custom[idx] = { ...state.custom[idx], ...full, id: state.editingId };
    else state.custom.push({ ...full, id: state.editingId });
    toast('Entry updated');
  } else {
    full.id = `${state.bank}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    full.updated_at = new Date().toISOString().slice(0, 10);
    full.trending = false;
    state.custom.push(full);
    toast('Entry added locally');
  }
  save();
  resetForm();
  renderTable();
}

function deleteItem(id) {
  if (!confirm('Delete this entry locally?')) return;
  state.deleted.push(id);
  save();
  renderTable();
  toast('Deleted locally (seed file untouched)');
}

function exportJson() {
  const data = merged();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.bank}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${data.length} entries`);
}

function copyJson() {
  navigator.clipboard.writeText(JSON.stringify(merged(), null, 2)).then(
    () => toast('JSON copied to clipboard'),
    () => toast('Copy failed')
  );
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error('not an array');
      state.custom = data;
      save();
      renderTable();
      toast(`Imported ${data.length} entries`);
    } catch {
      toast('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}

function setBank(bank) {
  state.bank = bank;
  state.editingId = null;
  state.q = '';
  document.querySelectorAll('[data-bank]').forEach((b) => {
    const on = b.dataset.bank === bank;
    b.classList.toggle('btn-soft', on);
    b.classList.toggle('btn-ghost', !on);
  });
  $('#form-extra').innerHTML = BANK_FIELDS[bank].extra;
  resetForm();
  load();
  fetch(`../data/${bank}.json`)
    .then((r) => r.json())
    .then((data) => {
      state.seed = data;
      renderTable();
    })
    .catch(() => {
      state.seed = [];
      renderTable();
      toast(`Could not load seed data/${bank}.json`);
    });
}

/* ---------- Auth gate ---------- */
const ADMIN_HASH = '87e94258ee2ec6497ee3ed1e74e4249764bd0ac42b226977f99c90802fedd09b'; // sha256 of the admin password
const AUTH_FLAG = 'wikiai.admin.auth';

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tryLogin() {
  const pass = $('#login-password').value;
  if ((await sha256(pass)) === ADMIN_HASH) {
    sessionStorage.setItem(AUTH_FLAG, '1');
    $('#login-overlay').classList.add('hidden');
    $('#login-error').textContent = '';
    initAdmin();
    return true;
  }
  $('#login-error').textContent = 'Wrong password';
  return false;
}

function initAuth() {
  const overlay = $('#login-overlay');
  if (sessionStorage.getItem(AUTH_FLAG) === '1') {
    overlay.classList.add('hidden');
    return true;
  }
  overlay.classList.remove('hidden');
  $('#login-submit').addEventListener('click', tryLogin);
  $('#login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin();
  });
  return false;
}

/* ---------- GitHub search & add ---------- */
let ghResults = [];

function guessCategory(r) {
  const text = ((r.description || '') + ' ' + (r.topics || []).join(' ')).toLowerCase();
  if (/(database|postgres|sqlite|mysql|mongo|redis|vector|embedding|rag)/.test(text)) return 'Databases & Storage';
  if (/(browser|playwright|puppeteer|scrap|selenium|automation)/.test(text)) return 'Browsing & Automation';
  if (/(search|web|crawl)/.test(text)) return 'Search & Web';
  if (/(slack|discord|telegram|whatsapp|email|gmail|mail|message)/.test(text)) return 'Communication';
  if (/(cloud|aws|gcp|azure|deploy|kubernetes|docker|devops|infra)/.test(text)) return 'Cloud & DevOps';
  if (/(observability|monitor|log|metric|trace|sentry|grafana|datadog)/.test(text)) return 'Observability';
  if (/(todo|calendar|notes|task|productivity)/.test(text)) return 'Productivity';
  if (/(design|image|figma|creative|photo|art)/.test(text)) return 'Design & Creative';
  if (/(llm|agent|claude|openai|prompt|mcp|model)/.test(text)) return 'AI & ML';
  return 'Developer Tools';
}

function ghToEntry(repo) {
  const pretty = (s) =>
    String(s || '')
      .split(/[-_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const base = {
    id: `${state.bank}-gh-${repo.id}`,
    name: pretty(repo.name),
    slug: repo.name,
    url: repo.html_url,
    short: (repo.description || '').slice(0, 130),
    description: repo.description || '',
    tags: (repo.topics || []).slice(0, 6),
    updated_at: (repo.pushed_at || '').slice(0, 10),
    trending: false,
  };
  if (state.bank === 'mcps') {
    base.category = guessCategory(repo);
    base.transports = [];
    base.auth = '';
    base.publisher = repo.owner ? repo.owner.login : '';
    base.official = false;
    base.install = '';
  } else if (state.bank === 'skills') {
    base.category = guessCategory(repo);
    base.difficulty = 'medium';
    base.input = '';
    base.output = '';
    base.source = repo.full_name || '';
  } else {
    base.categories = [guessCategory(repo)];
    base.pricing = 'unknown';
  }
  return base;
}

async function githubSearch() {
  const q = $('#gh-query').value.trim() || 'topic:mcp-server';
  const el = $('#gh-results');
  el.innerHTML = '<p class="muted" style="font-size:13px">Searching GitHub…</p>';
  try {
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=15`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    ghResults = data.items || [];
    renderGhResults();
  } catch (e) {
    el.innerHTML = `<p class="muted" style="font-size:13px">Search failed (${esc(e.message)}). Unauthenticated GitHub rate limit is ~10 searches/hour — try again later.</p>`;
  }
}

function renderGhResults() {
  const el = $('#gh-results');
  if (!ghResults.length) {
    el.innerHTML = '<p class="muted" style="font-size:13px">No results.</p>';
    return;
  }
  const existing = new Set(merged().map((x) => x.url));
  el.innerHTML = ghResults
    .map((r) => {
      const added = existing.has(r.html_url);
      return `<div class="search-result">
        <div class="sr-info"><b>${esc(r.full_name)}</b><span>${esc(r.description || '')}</span></div>
        <span class="sr-stars">★ ${r.stargazers_count}</span>
        <button class="btn btn-ghost btn-sm" data-action="gh-add" data-url="${esc(r.html_url)}" ${added ? 'disabled' : ''}>${added ? 'Added' : 'Add'}</button>
      </div>`;
    })
    .join('');
}

function ghAdd(url) {
  const repo = ghResults.find((r) => r.html_url === url);
  if (!repo) return;
  if (merged().some((x) => x.url === repo.html_url)) {
    toast('Already in the bank');
    renderGhResults();
    return;
  }
  state.custom.push(ghToEntry(repo));
  save();
  renderTable();
  renderGhResults();
  toast(`Added ${repo.full_name}`);
}

function ghAddAll() {
  const existing = new Set(merged().map((x) => x.url));
  const fresh = ghResults.filter((r) => !existing.has(r.html_url));
  fresh.forEach((r) => state.custom.push(ghToEntry(r)));
  save();
  renderTable();
  renderGhResults();
  toast(`Added ${fresh.length} repositories`);
}

/* ---------- Boot ---------- */
function initAdmin() {
  document.querySelectorAll('[data-bank]').forEach((b) => b.addEventListener('click', () => setBank(b.dataset.bank)));

  $('#entry-form').addEventListener('submit', submitForm);
  $('#form-reset').addEventListener('click', resetForm);
  $('#export-json').addEventListener('click', exportJson);
  $('#copy-json').addEventListener('click', copyJson);
  $('#import-file').addEventListener('change', (e) => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  $('#table-body').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit') editItem(btn.dataset.id);
    if (btn.dataset.action === 'delete') deleteItem(btn.dataset.id);
  });

  // Search filter above the table
  const wrap = document.querySelector('.row-count');
  const input = document.createElement('input');
  input.placeholder = 'Filter rows…';
  input.style.maxWidth = '260px';
  input.style.marginLeft = '12px';
  input.style.display = 'inline-block';
  input.style.width = 'auto';
  wrap.appendChild(input);
  input.addEventListener('input', () => {
    state.q = input.value;
    renderTable();
  });

  // GitHub search & add
  $('#gh-search').addEventListener('click', githubSearch);
  $('#gh-query').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') githubSearch();
  });
  $('#gh-add-all').addEventListener('click', ghAddAll);
  $('#gh-results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="gh-add"]');
    if (btn && !btn.disabled) ghAdd(btn.dataset.url);
  });

  setBank('tools');
}

document.addEventListener('DOMContentLoaded', () => {
  if (!initAuth()) return; // locked until password is entered
});