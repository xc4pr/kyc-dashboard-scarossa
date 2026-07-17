'use strict';

// ─── SECO-Sanktionsliste (Schweiz) ────────────────────────────────────────────
// Lädt die konsolidierte XML-Gesamtliste (~40 MB), baut daraus einen kompakten
// Suchindex und gleicht KYC-Namen lokal ab. Gratis, kein API-Key nötig.
// Neues XML-Format seit 06.12.2023: swiss-sanctions-list > target > individual|entity
//   > identity > name > name-part > value (+ spelling-variant).

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const match = require('./match');

let INDEX_FILE = null;
let indexCache = null;

function init(dataDir) {
  INDEX_FILE = path.join(dataDir, 'seco-index.json');
  if (fs.existsSync(INDEX_FILE)) {
    try { indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); } catch (_) { indexCache = null; }
  }
}

function arr(x) { return x == null ? [] : (Array.isArray(x) ? x : [x]); }
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') return (v['#text'] != null ? String(v['#text']) : '');
  return String(v);
}

// XML-String → kompakter Index { listDate, entries: [{ssid, kind, names[], years[]}] }
function buildIndex(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => ['target', 'identity', 'name', 'name-part', 'spelling-variant', 'day-month-year'].includes(name)
  });
  const root = parser.parse(xmlString);
  const list = root['swiss-sanctions-list'] || {};
  const listDate = list['@_date'] || null;
  const targets = arr(list.target);

  const entries = [];
  for (const t of targets) {
    const ssid = t['@_ssid'] || '';
    const node = t.individual || t.entity;
    if (!node) continue;
    const kind = t.individual ? 'individual' : 'entity';

    const names = new Set();
    const years = new Set();

    for (const id of arr(node.identity)) {
      for (const nm of arr(id.name)) {
        const parts = arr(nm['name-part']);
        const toks = [];
        for (const p of parts) {
          if (p.value != null) toks.push(text(p.value));
          for (const sv of arr(p['spelling-variant'])) toks.push(text(sv));
        }
        const full = toks.filter(Boolean).join(' ').trim();
        if (full) names.add(full);
      }
      for (const dmy of arr(id['day-month-year'])) {
        const y = dmy['@_year'];
        if (y) years.add(String(y));
      }
    }

    if (names.size === 0) continue;
    entries.push({
      ssid,
      kind,
      names: Array.from(names),
      years: Array.from(years)
    });
  }
  return { listDate, entries };
}

// Liste herunterladen, Index bauen, speichern. Rückgabe: Meta.
async function refresh(url) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error('SECO-Download fehlgeschlagen: HTTP ' + resp.status);
  const xml = await resp.text();
  if (xml.length < 10000 || xml.indexOf('swiss-sanctions-list') === -1) {
    throw new Error('SECO-Antwort sieht nicht wie die Sanktionsliste aus (evtl. URL veraltet).');
  }
  const built = buildIndex(xml);
  indexCache = built;
  fs.writeFileSync(INDEX_FILE, JSON.stringify(built), 'utf-8');
  return {
    lastDownload: new Date().toISOString(),
    listDate: built.listDate,
    entryCount: built.entries.length
  };
}

function isReady() { return !!(indexCache && indexCache.entries && indexCache.entries.length); }
function meta() {
  if (!indexCache) return { listDate: null, entryCount: 0 };
  return { listDate: indexCache.listDate, entryCount: indexCache.entries.length };
}

// Einen Namen gegen die SECO-Liste prüfen. Rückgabe: Array von Treffern.
function screen(queryName, opts) {
  const fuzzy = opts && opts.fuzzy !== false;
  if (!isReady() || !queryName) return [];
  const hits = [];
  for (const e of indexCache.entries) {
    const best = match.scoreAgainstMany(queryName, e.names, fuzzy);
    if (best.matched) {
      hits.push({
        source: 'SECO',
        source_type: 'SANCTION',
        ssid: e.ssid,
        kind: e.kind,
        name: best.via,
        aliases: e.names.filter(n => n !== best.via).slice(0, 5),
        years: e.years,
        score: Math.round(best.score * 100) / 100
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 25);
}

module.exports = { init, buildIndex, refresh, screen, isReady, meta };
