/* Regenerate data/ids.json — the URL baseline the daily crawler uses to avoid
   re-adding entries that already ship in the seed files. Run whenever the seed
   banks are updated (e.g. after publishing admin exports):
     node scripts/gen-ids.mjs
   Output is committed to the repo and served as a static asset. */

import { readFileSync, writeFileSync } from 'node:fs';

const out = {};
for (const bank of ['tools', 'mcps', 'skills']) {
  const data = JSON.parse(readFileSync(`data/${bank}.json`, 'utf8'));
  out[bank] = data.map((e) => e.url).filter(Boolean);
}
writeFileSync('data/ids.json', JSON.stringify(out));
console.log(`data/ids.json written (${out.tools.length} tools, ${out.mcps.length} mcps, ${out.skills.length} skills urls)`);
