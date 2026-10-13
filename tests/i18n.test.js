'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load');

// i18n.js reads the saved language and wires up buttons when it loads.
const { STRINGS, LANGS } = load(['i18n.js'], ['STRINGS', 'LANGS'], {
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { languages: ['en'] },
  document: { querySelectorAll: () => [] },
});

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const jsDir = path.join(__dirname, '..', 'js');
const js = fs.readdirSync(jsDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(jsDir, f), 'utf8'))
  .join('\n');

test('every language has the same keys as English', () => {
  const en = Object.keys(STRINGS.en).filter((k) => !k.startsWith('unit.')).sort();
  for (const lang of LANGS) {
    const keys = Object.keys(STRINGS[lang]).filter((k) => !k.startsWith('unit.')).sort();
    assert.deepEqual(keys, en, lang);
  }
});

test('every key used in index.html exists', () => {
  const used = [...html.matchAll(/data-(?:i18n(?:-html|-title|-label)?|note)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 50);
  for (const key of new Set(used)) assert.ok(key in STRINGS.en, key);
});

test('every literal t(\'…\') key in the scripts exists', () => {
  const used = [...js.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const key of new Set(used)) assert.ok(key in STRINGS.en, key);
});

test('year units cover every plural form of each language', () => {
  for (const lang of LANGS) {
    for (const form of new Intl.PluralRules(lang).resolvedOptions().pluralCategories) {
      assert.ok(`unit.year.${form}` in STRINGS[lang], `${lang}: unit.year.${form}`);
    }
  }
});
