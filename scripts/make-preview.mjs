// Generates preview.html — a self-contained copy of the site (inlined CSS/JS/data)
// for visual verification in the Freebuff preview. Not deployed.
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
const js = fs.readFileSync('main.js', 'utf8');
const tools = JSON.parse(fs.readFileSync('data/tools.json', 'utf8')).slice(0, 60);
const mcps = JSON.parse(fs.readFileSync('data/mcps.json', 'utf8'));
const skills = JSON.parse(fs.readFileSync('data/skills.json', 'utf8'));

const stub = `
<script>
// Preview stub: serve embedded data instead of fetching
const __DATA__ = {
  'data/tools.json': ${JSON.stringify(tools)},
  'data/mcps.json': ${JSON.stringify(mcps)},
  'data/skills.json': ${JSON.stringify(skills)},
};
window.fetch = (url) => {
  if (__DATA__[url]) return Promise.resolve(new Response(JSON.stringify(__DATA__[url]), { status: 200, ok: true }));
  return Promise.reject(new Error('no preview data for ' + url));
};
</script>`;

const out = html
  .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
  .replace('<script src="main.js"></script>', `${stub}<script>${js}</script>`)
  .replace('<link href="https://fonts.googleapis.com/css2?family=Public+Sans', '<link href="https://fonts.googleapis.com/css2?family=Public+Sans'); // keep fonts

fs.writeFileSync('preview.html', out);
console.log('preview.html written (' + (out.length / 1024).toFixed(0) + ' KB)');