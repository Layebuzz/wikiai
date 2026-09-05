/* WikiAI Worker — serves the static site (assets), exposes the KV-backed
   custom additions file the site merges at runtime, and runs the daily
   crawler on a morning Cron Trigger. */

import { runIngest } from './crawl.js';

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const CUSTOM_CACHE = {
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // The additions file the site fetches to merge over its seed banks.
    if (request.method === 'GET' && url.pathname === '/data/custom.json') {
      try {
        const raw = await env.KV.get('custom');
        return new Response(raw || '{"tools":[],"mcps":[],"skills":[]}', {
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...CUSTOM_CACHE },
        });
      } catch {
        return json({ tools: [], mcps: [], skills: [] });
      }
    }

    // Manual crawler trigger (guarded). Cron is the primary path.
    if (request.method === 'POST' && url.pathname === '/api/ingest') {
      if (!env.INGEST_KEY) return json({ error: 'ingest not enabled' }, 503);
      let body = {};
      try {
        body = await request.json();
      } catch {
        /* empty body */
      }
      if (body.key !== env.INGEST_KEY) return json({ error: 'forbidden' }, 403);
      try {
        const report = await runIngest(env, { force: true });
        return json(report);
      } catch (err) {
        return json({ error: String((err && err.message) || err) }, 500);
      }
    }

    // Everything else: static assets (index, data banks, admin, favicon…).
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runIngest(env, { force: false }).catch((err) => {
        console.error('cron ingest failed', err);
      })
    );
  },
};
