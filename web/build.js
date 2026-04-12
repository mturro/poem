#!/usr/bin/env node
/**
 * build.js
 *
 * reads the git history of mturro/poem
 * writes static HTML to web/dist/
 *
 * this file is part of the poem.
 */

'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(__dirname, 'dist');
const REPO = 'https://github.com/mturro/poem';

// ─── helpers ──────────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git -C "${ROOT}" ${cmd}`, { encoding: 'utf8' }).trim();
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug(filename) {
  return filename.replace(/\.md$/, '');
}

// ─── git data ─────────────────────────────────────────────────────────────────

// ensure we have the full history (netlify does shallow clones by default)
try {
  execSync(`git -C "${ROOT}" fetch --unshallow`, { encoding: 'utf8', stdio: 'pipe' });
} catch (_) { /* already full, or not shallow */ }

// all commits across the repo, newest first
function allCommits() {
  const raw = git(`log --format="%H|%ad|%s" --date=short`);
  return raw.split('\n').filter(Boolean).map(line => {
    const [sha, date, ...rest] = line.split('|');
    return { sha: sha.trim(), short: sha.trim().slice(0, 7), date, message: rest.join('|') };
  });
}

// commits that touched a specific file, returned oldest-first
function fileCommits(filename) {
  const raw = git(`log --follow --format="%H|%ad|%s" --date=short -- "${filename}"`);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [sha, date, ...rest] = line.split('|');
    return { sha: sha.trim(), short: sha.trim().slice(0, 7), date, message: rest.join('|') };
  }).reverse();
}

// unified diff for one commit's changes to one file
function fileDiff(sha, filename) {
  const parents = git(`rev-list --parents -n 1 ${sha}`).split(' ').slice(1);
  if (parents.length === 0) {
    // root commit — render the whole file as additions
    try {
      const content = git(`show ${sha}:"${filename}"`);
      return content.split('\n').map(l => '+' + l).join('\n');
    } catch (_) { return ''; }
  }
  try {
    return git(`diff ${parents[0]} ${sha} -- "${filename}"`);
  } catch (_) { return ''; }
}

// ─── diff rendering ───────────────────────────────────────────────────────────

function renderDiff(raw) {
  if (!raw || !raw.trim()) return '';
  const lines = raw.split('\n');
  const out   = [];

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ')    ||
      line.startsWith('--- ')      ||
      line.startsWith('+++ ')
    ) continue;

    if (line.startsWith('@@')) {
      out.push(`<div class="diff-hunk">${esc(line)}</div>`);
    } else if (line.startsWith('+')) {
      out.push(`<div class="diff-add"><span aria-hidden="true">+</span>${esc(line.slice(1))}</div>`);
    } else if (line.startsWith('-')) {
      out.push(`<div class="diff-del"><span aria-hidden="true">-</span>${esc(line.slice(1))}</div>`);
    } else {
      out.push(`<div class="diff-ctx"><span aria-hidden="true"> </span>${esc(line.slice(1) ?? '')}</div>`);
    }
  }

  return out.join('\n');
}

// ─── html templates ───────────────────────────────────────────────────────────

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
${body}
</body>
</html>`;
}

function indexPage(poems, commits) {
  const firstDate = commits[commits.length - 1]?.date ?? '';
  const lastDate  = commits[0]?.date ?? '';

  const poemItems = poems.map(({ filename, commits: c }) => {
    const n = c.length;
    return `      <li>
        <a href="${slug(filename)}.html">${esc(filename)}</a>
        <span class="meta">${n} revision${n !== 1 ? 's' : ''}</span>
      </li>`;
  }).join('\n');

  const logLines = commits.map(({ short, sha, date, message }) =>
    `    <div class="log-line">` +
    `<a href="${REPO}/commit/${sha}" class="sha" rel="noopener">${short}</a>` +
    `<span class="date">${date}</span>` +
    `<span class="msg">${esc(message)}</span>` +
    `</div>`
  ).join('\n');

  return page('mturro/poem', `<header>
  <h1><a href="${REPO}" rel="noopener">mturro/poem</a></h1>
  <p class="subtitle">a poem in git &nbsp;&middot;&nbsp; ${commits.length} commits &nbsp;&middot;&nbsp; ${firstDate} &ndash; ${lastDate}</p>
</header>

<main>
  <section>
    <h2>poems</h2>
    <ul class="poem-list">
${poemItems}
    </ul>
  </section>

  <section>
    <h2><code>$ git log --oneline</code></h2>
    <div class="git-log" role="log" aria-label="full commit history">
${logLines}
    </div>
  </section>
</main>

<footer>
  <a href="${REPO}" rel="noopener">view on github</a>
</footer>`);
}

function poemPage(filename, commits) {
  const sections = commits.map(({ short, sha, date, message }) => {
    const diff    = fileDiff(sha, filename);
    const diffHtml = renderDiff(diff);
    return `  <section class="commit" aria-label="commit ${short}">
    <div class="commit-meta">
      <a href="${REPO}/commit/${sha}" class="sha" rel="noopener">${short}</a>
      <span class="date">${date}</span>
      <span class="msg">${esc(message)}</span>
    </div>
    ${diffHtml ? `<div class="diff-block" role="region" aria-label="changes in this commit">\n${diffHtml}\n    </div>` : ''}
  </section>`;
  }).join('\n\n');

  return page(`${filename} — mturro/poem`, `<header>
  <a href="index.html" class="back">&larr; mturro/poem</a>
  <h1>${esc(filename)}</h1>
  <p class="cmd"><code>$ git log --follow --patch -- ${esc(filename)}</code></p>
</header>

<main>
${sections}
</main>

<footer>
  <a href="${REPO}/commits/master/${filename}" rel="noopener">full history on github</a>
</footer>`);
}

// ─── build ────────────────────────────────────────────────────────────────────

console.log('building mturro/poem …');

const poemFiles = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.md') && f !== 'README.md')
  .sort();

const poems   = poemFiles.map(filename => ({ filename, commits: fileCommits(filename) }));
const commits = allCommits();

fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'src', 'style.css'), path.join(DIST, 'style.css'));

fs.writeFileSync(path.join(DIST, 'index.html'), indexPage(poems, commits));
console.log('  index.html');

for (const { filename, commits: c } of poems) {
  fs.writeFileSync(path.join(DIST, `${slug(filename)}.html`), poemPage(filename, c));
  console.log(`  ${slug(filename)}.html`);
}

console.log('done.');
