/* Local check for the crawler: runs one real ingest against live sources with an
   in-memory KV, then asserts bank purity, entry shapes, and cross-run dedupe. */

import { readFileSync } from 'node:fs';
import { runIngest, bankForGitHubRepo, categorizeBankEntry, MCP_CATS, SKILL_CATS, TOOL_CATS } from '../crawl.js';

const store = new Map();
const kv = {
  get: async (k) => (store.has(k) ? store.get(k) : null),
  put: async (k, v) => store.set(k, v),
};
const assets = {
  fetch: async () => new Response(readFileSync('data/ids.json')),
};
const env = { KV: kv, ASSETS: assets };

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) {
    failures++;
    console.error('  FAIL: ' + msg);
  }
};

/* --- Classifier separation (no cross-bank leakage) --- */
const gh = (name, desc, topics = []) => ({ name, description: desc, topics });
ok(bankForGitHubRepo(gh('mcp-server-postgres', 'MCP server for Postgres')) === 'mcps', 'mcp repo -> mcps');
ok(bankForGitHubRepo(gh('claude-skill-browser', 'An agent skill for the browser', ['claude-skills'])) === 'skills', 'skill repo -> skills');
ok(bankForGitHubRepo(gh('langchain', 'Framework for LLM applications')) === 'tools', 'plain repo -> tools');
ok(bankForGitHubRepo(gh('database-connector', 'Talk to databases')) === 'tools', 'database repo w/o mcp markers -> tools (not mcps)');
ok(MCP_CATS.includes(categorizeBankEntry('mcps', 'syncs Postgres, MySQL and Redis data', '')), 'mcps category in vocab');
ok(SKILL_CATS.includes(categorizeBankEntry('skills', 'create pdf and docx documents', '')), 'skill category in vocab');
ok(TOOL_CATS.includes(categorizeBankEntry('tools', 'image generation app', '')), 'tool category in vocab');

/* --- One real run (day 1) --- */
const day1 = await runIngest(env, { now: '2026-09-06T03:00:00Z', force: false });
console.log('day1 report:', JSON.stringify({ added: day1.added, sources: day1.sources, errors: day1.errors }, null, 1));

const custom1 = JSON.parse(store.get('custom'));
const assertShape = (bank, list) => {
  const cats = bank === 'mcps' ? MCP_CATS : bank === 'skills' ? SKILL_CATS : TOOL_CATS;
  for (const e of list) {
    ok(e.name && e.url && e.description_en || e.description || e.short, `${bank}: ${e.name} has readable description`);
    if (bank === 'mcps') {
      ok(typeof e.category === 'string' && e.category.length > 0, `mcps ${e.name} has single category (${e.category})`);
      ok(Array.isArray(e.transports), `mcps ${e.name} has transports array`);
      ok(!e.categories, `mcps ${e.name} has no tools-style categories[]`);
    } else if (bank === 'skills') {
      ok(typeof e.category === 'string', `skills ${e.name} has category string, got ${JSON.stringify(e.category)}`);
      ok(!e.categories, `skills ${e.name} has no categories[]`);
      ok(e.difficulty, `skills ${e.name} has difficulty`);
    } else {
      ok(Array.isArray(e.categories) && e.categories.length, `tools ${e.name} has categories[]`);
      ok(typeof e.category === 'undefined' || e.category == null, `tools ${e.name} has no single-category string`);
      ok(e.name !== 'AI tool', `tools ${e.url} got the placeholder 'AI tool' as its name`);
    }
  }
};
assertShape('mcps', custom1.mcps);
assertShape('skills', custom1.skills);
assertShape('tools', custom1.tools);

/* --- Same-day second trigger must skip (cron idempotency) --- */
const again = await runIngest(env, { now: '2026-09-06T03:30:00Z', force: false });
ok(again.skipped === true, 'same-day trigger skips');

/* --- Next day: only brand-new entries may be added, never day-1 ones --- */
const day2 = await runIngest(env, { now: '2026-09-07T03:00:00Z', force: false });
console.log('day2 report:', JSON.stringify({ added: day2.added, errors: day2.errors }, null, 1));
const custom2 = JSON.parse(store.get('custom'));
for (const bank of ['mcps', 'skills', 'tools']) {
  const urls1 = new Set(custom1[bank].map((e) => e.url.toLowerCase()));
  const newOnes = custom2[bank].slice(custom1[bank].length); // additions append at the end
  const reAdded = newOnes.filter((e) => urls1.has(e.url.toLowerCase()));
  ok(reAdded.length === 0, `${bank}: day-1 url re-added on day 2 (${reAdded.map((d) => d.url).join(', ')})`);
  ok(
    custom2[bank].length === custom1[bank].length + day2.added[bank],
    `${bank}: growth matches report (${custom1[bank].length} -> ${custom2[bank].length}, reported +${day2.added[bank]})`
  );
  const unique = new Set(custom2[bank].map((e) => e.url.toLowerCase()));
  ok(unique.size === custom2[bank].length, `${bank}: no intra-list duplicates`);
}

console.log(failures === 0 ? '\nCRAWLER-CHECK PASSED' : `\nCRAWLER-CHECK FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
