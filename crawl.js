/* WikiAI daily crawler — pulls candidate entries from several public services,
   routes each one to exactly one bank (tools / mcps / skills), assigns a category
   from that bank's vocabulary, enriches what it can, dedupes, and persists the
   additions in Workers KV. Runs from worker.js on a Cron Trigger; kept CPU-lean
   (free-plan cron budget is ~10 ms) so remote payloads are small and no seed
   JSON is parsed here. */

'use strict';

export const BANKS = ['tools', 'mcps', 'skills'];

/* ----- Category vocabularies (reused from the shipped seed data) ----- */

export const MCP_CATS = [
  'Developer Tools', 'Browsing & Automation', 'Search & Web', 'AI & ML', 'Docs & Knowledge',
  'Communication', 'Productivity', 'Databases & Storage', 'Data & Analytics', 'Cloud & DevOps',
  'Finance', 'Observability', 'Design & Creative', 'Marketing', 'Entertainment',
];

export const SKILL_CATS = [
  'Document Processing', 'Design & Creative', 'Coding & Engineering', 'AI/ML Workflows',
  'Communication', 'Research & Analysis', 'Data & Files', 'Writing & Content', 'DevOps & Operations',
];

export const TOOL_CATS = [
  'Chat', 'Generative Art', 'Generative Code', 'Generative Video', 'Video Editing', 'Text-To-Speech',
  'Speech-To-Text', 'Music', 'Productivity', 'Marketing', 'Social Media', 'Research', 'Finance',
  'AI Detection', 'Copywriting', 'Translation', 'Gaming', 'Avatar', 'AI Models',
];

/* Daily keyword pools — each morning run picks a slice per weekday so a wider
   vocabulary is covered over the week. */
const DAY_QUERIES = {
  mcps: [
    'topic:mcp-server stars:>100',
    '"mcp server" database language:typescript',
    '"model context protocol" server official',
    '"mcp server" llm agent',
    '"mcp server" api integration',
    '"mcp server" cloud platform',
    '"mcp server" search browser',
  ],
  skills: [
    'topic:claude-skills',
    'topic:agent-skills',
    '"agent skills" claude',
    'skill SKILL.md agent',
    'claude skills repository',
  ],
};

const ROTATING_TOOL_KEYWORDS = [
  ['ai chat assistant', 'ai image generator'],
  ['ai coding tool', 'text to speech ai'],
  ['ai video generator', 'ai music generator'],
  ['llm rag', 'ai agent framework'],
  ['ai research tool', 'ai design generator'],
  ['ai meeting assistant', 'ai translator'],
  ['open source ai', 'ai workflow automation'],
];

/* Keyword classifier — the bank a *GitHub* repo belongs to. GitHub is the only
   ambiguous source: MCP / skill signals win, so servers never leak into tools
   and skills never land in the MCP bank. */
export function bankForGitHubRepo(repo) {
  const text = [repo.name, repo.description || '', (repo.topics || []).join(' ')].join(' ').toLowerCase();
  if (/(^|[^a-z])mcp([^a-z]|$)|model context protocol|mcp-server/.test(text)) return 'mcps';
  if (/(^|[^a-z])skill([^a-z]|$)|skil\.md/.test(text) || (repo.topics || []).some((t) => /skill/i.test(t))) return 'skills';
  return 'tools';
}

function classifyWith(text, rules, fallback) {
  const t = String(text || '').toLowerCase();
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return fallback;
}

const MCP_RULES = [
  [/(database|postgres|sqlite|mysql|mongo|redis|vector|embedding|rag|chroma|pinecone|qdrant|weaviate|milvus|neo4j|graphql)/, 'Databases & Storage'],
  [/(browser|playwright|puppeteer|scrap|selenium|chrome|firefox|automation)/, 'Browsing & Automation'],
  [/(search|web |crawl|seo|google)/, 'Search & Web'],
  [/(slack|discord|telegram|whatsapp|email|gmail|mail|message|chat)/, 'Communication'],
  [/(cloud|aws|gcp|azure|deploy|kubernetes|docker|devops|infra|terraform|s3|lambda)/, 'Cloud & DevOps'],
  [/(observability|monitor|log|metric|trace|sentry|grafana|datadog|langsmith)/, 'Observability'],
  [/(todo|calendar|notes|task|productivity|notion|linear|jira|asana|office)/, 'Productivity'],
  [/(design|image|figma|creative|photo|art|canva|blender)/, 'Design & Creative'],
  [/(finance|bank|payment|trading|stock|invoice|stripe|accounting|tax)/, 'Finance'],
  [/(marketing|ads|social|content|newsletter)/, 'Marketing'],
  [/(llm|agent|claude|openai|prompt|model|gpt|huggingface|fine.?tun)/, 'AI & ML'],
  [/(docs|knowledge|wiki|confluence|notion|pdf|drive|dropbox|box|evernote)/, 'Docs & Knowledge'],
  [/(analytics|pipeline|airflow|kafka|spark|dbt|warehouse|etl|snowflake|bigquery)/, 'Data & Analytics'],
];

const SKILL_RULES = [
  [/(pdf|docx|doc |word|excel|spreadsheet|ppt|slide|document|office|xlsx|csv|file)/, 'Document Processing'],
  [/(design|figma|image|photo|art|svg|brand|creative|illustrat)/, 'Design & Creative'],
  [/(code|coding|programming|dev|software|debug|repo|github|javascript|python|sql|test|engineering)/, 'Coding & Engineering'],
  [/(llm|agent|claude|prompt|model|ml|ai|workflow|automation)/, 'AI/ML Workflows'],
  [/(research|analy|search|summar|investigat|web)/, 'Research & Analysis'],
  [/(data|dataset|extract|format|convert)/, 'Data & Files'],
  [/(write|writing|content|blog|article|editorial|story|copy)/, 'Writing & Content'],
  [/(deploy|devops|k8s|kubernetes|cloud|aws|docker|git|ci|infra|ops)/, 'DevOps & Operations'],
  [/(slack|discord|email|message|communication|interview)/, 'Communication'],
];

const TOOL_RULES = [
  [/(chat|assistant|conversation|llm|gpt|claude|bard|chatbot|text.?generation)/, 'Chat'],
  [/(image|art|photo|design|draw|illustrat|diffusion|visual)/, 'Generative Art'],
  [/(code|coding|program|develop|debug|dev)/, 'Generative Code'],
  [/(video|film|movie)/, 'Generative Video'],
  [/(speech|voice|tts|text.?to.?speech)/, 'Text-To-Speech'],
  [/(stt|asr|speech.?to.?text|transcri)/, 'Speech-To-Text'],
  [/(music|song|audio|beat|sound)/, 'Music'],
  [/(meeting|notes|productivity|office|calendar|email)/, 'Productivity'],
  [/(market|ads|copy|seo|content|social)/, 'Marketing'],
  [/(search|research|analy|summar|knowledge|web)/, 'Research'],
  [/(finance|stock|invest|trading|bank)/, 'Finance'],
  [/(detect|safety|moder|deepfake|plagiarism)/, 'AI Detection'],
];

const HF_TASK_CATS = {
  'text-generation': 'Chat', 'text2text-generation': 'Chat', 'text-classification': 'Research',
  'image-to-text': 'Research', 'text-to-image': 'Generative Art', 'image-to-image': 'Generative Art',
  'text-to-video': 'Generative Video', 'text-to-speech': 'Text-To-Speech', 'text-to-audio': 'Music',
  'automatic-speech-recognition': 'Speech-To-Text', 'audio-to-audio': 'Music', 'image-classification': 'AI Models',
  'object-detection': 'AI Models', 'image-segmentation': 'AI Models', 'question-answering': 'Chat',
  'summarization': 'Research', 'translation': 'Translation', 'feature-extraction': 'AI Models',
  'image-editing': 'Generative Art', 'zero-shot-classification': 'AI Models', 'audio-classification': 'AI Models',
};

export function categorizeBankEntry(bank, text, fallback) {
  if (bank === 'mcps') return classifyWith(text, MCP_RULES, fallback || 'Developer Tools');
  if (bank === 'skills') return classifyWith(text, SKILL_RULES, fallback || 'AI/ML Workflows');
  return classifyWith(text, TOOL_RULES, fallback || 'Productivity');
}

/* ----- Small utilities ----- */

function urlKey(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function pretty(s) {
  return String(s || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function clean(text, max) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

function todayUTC(now) {
  return now.toISOString().slice(0, 10);
}

async function getJSON(kv, key, fallback) {
  try {
    const raw = await kv.get(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchText(url, opts, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'wikiai-crawler/1.0 (daily catalog)',
        Accept: 'application/json, text/plain;q=0.8, */*;q=0.1',
        ...(opts && opts.headers),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.body && res.body.cancel) res.body.cancel();
      throw new Error('HTTP ' + res.status + ' ' + url);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/* ----- GitHub repo -> MCP entry ----- */

function detectTransport(readmeHead) {
  const t = String(readmeHead || '').toLowerCase();
  const transports = [];
  if (/\bstdio\b/.test(t)) transports.push('stdio');
  if (/\bhttp\b|\bsse\b|streamable/.test(t)) transports.push('http');
  let auth = '';
  if (/oauth/i.test(t)) auth = 'OAuth';
  else if (/bearer|access token/i.test(t)) auth = 'API token';
  else if (/api[ -]?key/i.test(t)) auth = 'API key';
  let install = '';
  const m = t.match(/(npx [^\n<>]{3,140}|uvx [^\n<>]{3,140}|docker run [^\n<>]{3,140}|pip install [^\n<>]{3,140}|bunx [^\n<>]{3,140})/i);
  if (m) install = m[1].trim();
  return { transports: [...new Set(transports)], auth, install };
}

function mcpsFromRepos(repos) {
  const out = [];
  for (const r of repos) {
    if (!r || !r.html_url || !r.name) continue;
    const desc = clean(r.description, 400);
    out.push({
      id: 'mcp-kv-' + (r.full_name || r.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: pretty(r.name),
      slug: r.name,
      url: r.html_url,
      short: clean(r.description, 120) || 'MCP server: ' + pretty(r.name),
      description: desc || 'MCP server published on GitHub: ' + r.html_url,
      category: categorizeBankEntry('mcps', (r.description || '') + ' ' + (r.topics || []).join(' ') + ' ' + r.name, 'Developer Tools'),
      transports: [],
      auth: '',
      official: false,
      publisher: r.owner && r.owner.login ? r.owner.login : '',
      install: '',
      tags: (r.topics || []).slice(0, 6),
      updated_at: String(r.pushed_at || '').slice(0, 10),
      trending: false,
    });
  }
  return out;
}

/* ----- GitHub repo -> skill entry ----- */

function skillsFromRepos(repos) {
  const out = [];
  for (const r of repos) {
    if (!r || !r.html_url || !r.name) continue;
    out.push({
      id: 'skill-kv-' + (r.full_name || r.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: pretty(r.name),
      slug: r.name,
      short: clean(r.description, 120) || 'Agent skill repository: ' + pretty(r.name),
      description: clean(r.description, 400) || 'Agent skill published on GitHub: ' + r.html_url,
      category: categorizeBankEntry('skills', (r.description || '') + ' ' + (r.topics || []).join(' ') + ' ' + r.name, 'AI/ML Workflows'),
      difficulty: 'medium',
      input: '',
      output: '',
      source: r.full_name || '',
      url: r.html_url,
      tags: (r.topics || []).slice(0, 6),
      trending: false,
      updated_at: String(r.pushed_at || '').slice(0, 10),
    });
  }
  return out;
}

/* ----- Tools from Hugging Face + Hacker News ----- */

function hfTools(models, kind) {
  const out = [];
  for (const m of models) {
    if (!m || !m.id) continue;
    const task = m.pipeline_tag || '';
    const tags = [task, m.library_name].filter(Boolean);
    const cat =
      HF_TASK_CATS[task] ||
      (kind === 'spaces' ? categorizeBankEntry('tools', m.id + ' ' + tags.join(' '), 'Productivity') : 'AI Models');
    const downloads = m.downloads || 0;
    const kindLabel = kind === 'spaces' ? 'AI app (space)' : 'AI model';
    const short =
      (task ? 'Hugging Face ' + kindLabel + ' — ' + task.replace(/-/g, ' ') + '.' : 'Hugging Face ' + kindLabel + '.') +
      (downloads ? ' ~' + Math.round(downloads / 1000) + 'k downloads.' : '');
    out.push({
      id: 'tool-hf-' + m.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: pretty(m.id.split('/').pop()),
      slug: m.id,
      url: 'https://huggingface.co/' + (kind === 'spaces' ? 'spaces/' : '') + m.id,
      logo: '',
      short,
      categories: [cat],
      pricing: 'free',
      tags: tags.slice(0, 5),
      features: [],
      lang_support: [],
      updated_at: String(m.lastModified || '').slice(0, 10),
      description_en: clean(m.id + ' — a ' + kindLabel + ' on Hugging Face' + (task ? ' for ' + task.replace(/-/g, ' ') : '') + '.', 300),
      trending: m.likes > 100,
      _src: 'huggingface',
    });
  }
  return out;
}

const HN_JUNK_HOSTS = /(github\.com|youtube\.com|reddit\.com|twitter\.com|x\.com|medium\.com|substack\.com|news\.ycombinator\.com|huggingface\.co|producthunt\.com|linkedin\.com)/;

/* Product name for an HN launch: the brand from the submission's own domain
   (airlune.space -> AirLune). The title alone is unreliable — a naive strip of
   "Show HN:" can swallow the whole string, so the title is only a fallback. */
export function hnName(url, title) {
  try {
    const label = new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
    if (label.length > 1 && /[a-z]/.test(label) && /^[a-z0-9-]+$/.test(label)) return pretty(label);
  } catch {
    /* fall through to the title */
  }
  return pretty(String(title || '').trim().replace(/^(?:show|launch|ask)\s+hn\s*[:—-]\s*/i, '')) || 'AI tool';
}

function hnTools(hits) {
  const out = [];
  for (const h of hits || []) {
    const url = h.url || '';
    if (!url || !/^https?:\/\//.test(url) || HN_JUNK_HOSTS.test(url)) continue;
    const title = clean(h.title, 200);
    if (!title) continue;
    const text = (title + ' ' + clean(h.story_text, 200)).toLowerCase();
    const aiLike = /(ai|llm|gpt|agent|chatbot|diffusion|machine learning|neural|assistant)/.test(text);
    if (!aiLike && (h.points || 0) < 40) continue;
    out.push({
      id: 'tool-hn-' + String(h.objectID || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: hnName(url, title).slice(0, 60) || 'AI tool',
      slug: urlKey(url).replace(/[^a-z0-9]+/gi, '-'),
      url,
      logo: '',
      short: clean(title, 120),
      categories: [categorizeBankEntry('tools', title, 'Productivity')],
      pricing: 'unknown',
      tags: ['hacker news'],
      features: [],
      lang_support: [],
      updated_at: todayUTC(new Date()),
      description_en: clean(h.story_text || title, 400),
      trending: false,
      _src: 'hacker-news',
    });
  }
  return out;
}

/* ----- Source adapters ----- */

async function ghSearch(env, q, sort, fetchImpl) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(q) + '&sort=' + (sort || 'stars') + '&order=desc&per_page=10';
  const res = await fetchText(url, { headers: env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {} }, fetchImpl);
  const data = await res.json();
  return data.items || [];
}

async function sourceGhMcp(env, q, fetchImpl) {
  const repos = await ghSearch(env, q, 'stars', fetchImpl);
  return { bank: 'mcps', entries: mcpsFromRepos(repos) };
}

async function sourceGhSkills(env, q, fetchImpl) {
  const repos = await ghSearch(env, q, 'stars', fetchImpl);
  return { bank: 'skills', entries: skillsFromRepos(repos) };
}

async function sourceAnthropicSkills(env, fetchImpl) {
  const res = await fetchText('https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1', { headers: env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + env.GITHUB_TOKEN } : {} }, fetchImpl);
  const data = await res.json();
  const paths = (data.tree || []).map((n) => n.path).filter((p) => /SKILL\.md$/.test(p));
  const out = [];
  for (const p of paths.slice(0, 8)) {
    const dir = p.split('/').slice(0, -1).join('/');
    const folder = dir.split('/').pop();
    out.push({
      id: 'skill-kv-anthropic-' + dir.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      name: pretty(folder),
      slug: folder,
      short: pretty(folder) + ' — reference skill from anthropics/skills.',
      description: pretty(folder) + ' — agent skill from the official anthropics/skills collection.',
      category: categorizeBankEntry('skills', dir, 'AI/ML Workflows'),
      difficulty: 'medium',
      input: '',
      output: '',
      source: 'anthropics/skills',
      url: 'https://github.com/anthropics/skills/tree/main/' + dir,
      tags: [],
      trending: false,
      updated_at: String(data.sha || '').slice(0, 10) || todayUTC(new Date()),
      _src: 'anthropics/skills',
    });
  }
  return { bank: 'skills', entries: out };
}

async function sourceHf(env, keyword, fetchImpl) {
  const res = await fetchText('https://huggingface.co/api/models?search=' + encodeURIComponent(keyword) + '&sort=downloads&direction=-1&limit=6', {}, fetchImpl);
  const models = await res.json();
  const res2 = await fetchText('https://huggingface.co/api/spaces?search=' + encodeURIComponent(keyword) + '&sort=likes&direction=-1&limit=6', {}, fetchImpl);
  const spaces = await res2.json();
  return { bank: 'tools', entries: hfTools(models, 'models').concat(hfTools(spaces, 'spaces')) };
}

async function sourceHn(fetchImpl) {
  const res = await fetchText('https://hn.algolia.com/api/v1/search_by_date?query=Show%20HN%20AI&tags=story&hitsPerPage=30', {}, fetchImpl);
  const data = await res.json();
  return { bank: 'tools', entries: hnTools(data.hits) };
}

/* ----- Enrichment: skim the README of a new GitHub repo to guess MCP details ----- */

async function enrichMcpReadme(entry, fetchImpl) {
  const m = String(entry.url || '').match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) return null;
  try {
    const res = await fetchText('https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/HEAD/README.md', {}, fetchImpl);
    const text = (await res.text()).slice(0, 60000);
    return detectTransport(text);
  } catch {
    return null;
  }
}

/* ----- The run ----- */

const DAILY_CAPS = { tools: 10, mcps: 10, skills: 4 };
const README_ENRICH = 4;

export async function runIngest(env, opts = {}) {
  const force = !!opts.force;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now ? new Date(opts.now) : new Date();
  const today = todayUTC(now);
  const report = { date: today, added: { tools: 0, mcps: 0, skills: 0 }, sources: {}, errors: [] };

  const kv = env.KV;
  const meta = (await getJSON(kv, 'meta', {})) || {};
  if (meta.lastDate === today && !force) {
    report.skipped = true;
    report.message = 'already ran today; use force to re-run';
    return report;
  }

  let ever = collapseEver(await getJSON(kv, 'ever', { tools: [], mcps: [], skills: [] }));
  let custom = collapseCustom(await getJSON(kv, 'custom', { tools: [], mcps: [], skills: [] }));
  const seenEver = {
    tools: new Set(ever.tools),
    mcps: new Set(ever.mcps),
    skills: new Set(ever.skills),
  };
  const customByKey = {
    tools: new Set(custom.tools.map((e) => urlKey(e.url))),
    mcps: new Set(custom.mcps.map((e) => urlKey(e.url))),
    skills: new Set(custom.skills.map((e) => urlKey(e.url))),
  };

  // Baseline: data/ids.json ships every known seed URL so shipped entries are
  // never re-added. Best-effort — dedupe still holds against KV history.
  const seedKeys = { tools: new Set(), mcps: new Set(), skills: new Set() };
  try {
    if (env.ASSETS) {
      const r = await env.ASSETS.fetch(new Request('https://wikiai.local/data/ids.json'));
      if (r.ok) {
        const ids = await r.json();
        for (const b of BANKS) seedKeys[b] = new Set((ids[b] || []).map((u) => urlKey(u)));
      }
    }
  } catch {
    /* ignore */
  }

  const accept = (bank, entry) => {
    const key = urlKey(entry.url);
    if (!key || !entry.name) return false;
    if (seenEver[bank].has(key) || customByKey[bank].has(key) || seedKeys[bank].has(key)) return false;
    seenEver[bank].add(key);
    return true;
  };

  const commit = (bank, entries) => {
    const cap = DAILY_CAPS[bank];
    for (const e of entries) {
      if (report.added[bank] >= cap) break;
      if (!accept(bank, e)) continue;
      e._added = today;
      custom[bank].push(e);
      ever[bank].push(urlKey(e.url));
      report.added[bank]++;
    }
  };

  const weekday = now.getUTCDay();

  /* --- MCP bank: GitHub MCP-server search, README-skimmed --- */
  try {
    const q = DAY_QUERIES.mcps[weekday % DAY_QUERIES.mcps.length];
    const { entries } = await sourceGhMcp(env, q, fetchImpl);
    const fresh = entries.filter((e) => !seenEver.mcps.has(urlKey(e.url)));
    report.sources.mcps = { query: q, candidates: entries.length };
    commit('mcps', entries);
    let enriched = 0;
    for (const e of fresh) {
      if (enriched >= README_ENRICH) break;
      const det = await enrichMcpReadme(e, fetchImpl);
      if (det && (det.transports.length || det.auth || det.install)) {
        Object.assign(e, det);
        enriched++;
      }
    }
  } catch (err) {
    report.errors.push('mcps: ' + ((err && err.message) || err));
  }

  /* --- Skills bank: official anthropics/skills + GitHub skill repos --- */
  try {
    const a = await sourceAnthropicSkills(env, fetchImpl);
    report.sources.anthropic = { candidates: a.entries.length };
    commit('skills', a.entries);
  } catch (err) {
    report.errors.push('anthropic skills: ' + ((err && err.message) || err));
  }
  try {
    const q = DAY_QUERIES.skills[weekday % DAY_QUERIES.skills.length];
    const { entries } = await sourceGhSkills(env, q, fetchImpl);
    report.sources.skills = { query: q, candidates: entries.length };
    commit('skills', entries);
  } catch (err) {
    report.errors.push('skills: ' + ((err && err.message) || err));
  }

  /* --- Tools bank: Hugging Face (models + spaces) + Hacker News launches --- */
  try {
    const kws = ROTATING_TOOL_KEYWORDS[weekday % ROTATING_TOOL_KEYWORDS.length];
    const kw = kws[weekday % 2];
    const { entries } = await sourceHf(env, kw, fetchImpl);
    report.sources.hf = { keyword: kw, candidates: entries.length };
    commit('tools', entries);
  } catch (err) {
    report.errors.push('huggingface: ' + ((err && err.message) || err));
  }
  try {
    const { entries } = await sourceHn(fetchImpl);
    report.sources.hn = { candidates: entries.length };
    commit('tools', entries);
  } catch (err) {
    report.errors.push('hacker news: ' + ((err && err.message) || err));
  }

  // Structural dedupe: whatever the sources returned, no URL may persist twice.
  // (Runs on every pass, so even a failed mid-run write can never leave dupes.)
  ever = collapseEver(ever);
  custom = collapseCustom(custom);

  const total = report.added.tools + report.added.mcps + report.added.skills;
  meta.lastDate = today;
  meta.lastRun = today + 'T' + now.toISOString().slice(11, 19) + 'Z';
  meta.addedToday = report.added;
  meta.sources = report.sources;
  meta.errors = report.errors;

  if (total > 0 || force) {
    await Promise.all([
      kv.put('ever', JSON.stringify(ever)),
      kv.put('custom', JSON.stringify(custom)),
      kv.put('meta', JSON.stringify(meta)),
    ]);
  }
  report.total = total;
  return report;
}

/* Collapse helpers — keep the first occurrence of every entry URL per bank. */
function collapseEver(ever) {
  ever = ever || {};
  const out = {};
  for (const b of BANKS) out[b] = [...new Set(ever[b] || [])];
  return out;
}

function collapseCustom(custom) {
  custom = custom || {};
  const out = { tools: [], mcps: [], skills: [] };
  for (const b of BANKS) {
    const seen = new Set();
    out[b] = (custom[b] || []).filter((e) => {
      const k = urlKey(e.url) || e.id;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}
