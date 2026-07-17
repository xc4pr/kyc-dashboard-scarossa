'use strict';

// ─── Lokaler JSON-Datenspeicher ───────────────────────────────────────────────
// Kein natives Modul (kein SQLite-Kompilieren) → läuft ohne Anpassung auf Linux
// und Windows. Für einige Dutzend bis wenige Hundert KYC-Personen völlig
// ausreichend. Speicherort: userData (beschreibbar auch in installierter App).

const fs = require('fs');
const path = require('path');

let DATA_DIR = null;
let DB_FILE = null;
let cache = null;

function init(userDataDir) {
  DATA_DIR = userDataDir;
  DB_FILE = path.join(DATA_DIR, 'kyc-datenbank.json');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  load();
  return DB_FILE;
}

function emptyDb() {
  return {
    schemaVersion: 1,
    persons: [],
    settings: {
      dilisenseApiKey: '',
      secoUrl: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=de&action=downloadXmlGesamtlisteAction',
      screeningIntervalDays: 7,        // mindestens wöchentlich
      fuzzy: true,                      // Fuzzy-Suche (Tippfehler-Toleranz)
      theme: 'dark'                     // 'dark' | 'light'
    },
    seco: { lastDownload: null, listDate: null, entryCount: 0 },
    meta: { createdAt: new Date().toISOString() }
  };
}

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      // Fehlende Felder auffüllen (Vorwärtskompatibilität)
      const def = emptyDb();
      cache.settings = Object.assign(def.settings, cache.settings || {});
      cache.seco = Object.assign(def.seco, cache.seco || {});
      if (!Array.isArray(cache.persons)) cache.persons = [];
    } else {
      cache = emptyDb();
      persist();
    }
  } catch (e) {
    // Beschädigte Datei sichern statt überschreiben (rote Linie: nichts verlieren)
    if (fs.existsSync(DB_FILE)) {
      const bak = DB_FILE + '.corrupt-' + Date.now();
      try { fs.copyFileSync(DB_FILE, bak); } catch (_) {}
    }
    cache = emptyDb();
    persist();
  }
}

function persist() {
  // Atomar schreiben: temp + rename → nie halb geschriebene Datei
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

function uid() {
  return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ─── Personen ─────────────────────────────────────────────────────────────────

function listPersons() {
  return cache.persons.slice();
}

function getPerson(id) {
  return cache.persons.find(p => p.id === id) || null;
}

// Ableiten des screening-relevanten Namens/Typs aus dem KYC-Formular-Datensatz
function deriveIdentity(kyc) {
  const d = kyc || {};
  if (d.vp_typ === 'jp') {
    return {
      kind: 'entity',
      displayName: d.jp_firma || '',
      screenName: d.jp_firma || '',
      dob: '',
      nationality: '',
      country: d.jp_ort || ''
    };
  }
  if (d.vp_typ === 'eu') {
    return {
      kind: 'entity',
      displayName: d.eu_firma || '',
      screenName: d.eu_firma || '',
      dob: '',
      nationality: '',
      country: d.eu_ort || ''
    };
  }
  // natürliche Person
  const name = [d.np_vorname, d.np_name].filter(Boolean).join(' ').trim();
  return {
    kind: 'individual',
    displayName: name,
    screenName: name,
    dob: d.np_geburtsdatum || '',
    nationality: d.np_staatsangehoerigkeit || '',
    country: d.np_ort || ''
  };
}

// isForeign: Screening via dilisense nur für Ausländer sinnvoll (SECO immer).
// Heuristik: Nationalität gesetzt und nicht Schweiz → Ausland. Manuell überschreibbar.
function guessForeign(kyc) {
  const nat = (kyc && kyc.np_staatsangehoerigkeit || '').toLowerCase().trim();
  if (!nat) return false;
  return !/(schweiz|switzerland|swiss|ch|schweizer)/.test(nat);
}

function upsertPerson(person) {
  const now = new Date().toISOString();
  const identity = deriveIdentity(person.kyc);
  if (person.id) {
    const idx = cache.persons.findIndex(p => p.id === person.id);
    if (idx === -1) throw new Error('Person nicht gefunden: ' + person.id);
    const prev = cache.persons[idx];
    cache.persons[idx] = Object.assign({}, prev, person, {
      identity,
      foreign: person.foreign != null ? person.foreign : (prev.foreign != null ? prev.foreign : guessForeign(person.kyc)),
      updatedAt: now
    });
    persist();
    return cache.persons[idx];
  }
  const rec = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    kyc: person.kyc || {},
    identity,
    foreign: person.foreign != null ? person.foreign : guessForeign(person.kyc),
    lastScreenedAt: null,
    screeningStatus: 'never',   // never | clear | review | hit | error
    screeningSummary: '',
    screenings: []              // Verlauf: {id, at, sources, status, hits:[...]}
  };
  cache.persons.push(rec);
  persist();
  return rec;
}

function deletePerson(id) {
  const idx = cache.persons.findIndex(p => p.id === id);
  if (idx === -1) return false;
  cache.persons.splice(idx, 1);
  persist();
  return true;
}

// Screening-Ergebnis an eine Person anhängen
function recordScreening(id, result) {
  const p = getPerson(id);
  if (!p) return null;
  p.lastScreenedAt = result.at;
  p.screeningStatus = result.status;
  p.screeningSummary = result.summary || '';
  p.screenings = p.screenings || [];
  p.screenings.unshift(result);
  if (p.screenings.length > 30) p.screenings.length = 30; // Verlauf begrenzen
  persist();
  return p;
}

// Fällige Personen: nie geprüft oder länger als Intervall her
function duePersons(intervalDays) {
  const days = intervalDays || cache.settings.screeningIntervalDays || 7;
  const cutoff = Date.now() - days * 86400000;
  return cache.persons.filter(p => {
    if (!p.lastScreenedAt) return true;
    return new Date(p.lastScreenedAt).getTime() < cutoff;
  });
}

// ─── Einstellungen / SECO-Meta ────────────────────────────────────────────────

function getSettings() { return Object.assign({}, cache.settings); }
function setSettings(patch) {
  cache.settings = Object.assign({}, cache.settings, patch || {});
  persist();
  return getSettings();
}

function getSeco() { return Object.assign({}, cache.seco); }
function setSeco(patch) {
  cache.seco = Object.assign({}, cache.seco, patch || {});
  persist();
  return getSeco();
}

function dbFilePath() { return DB_FILE; }
function dataDir() { return DATA_DIR; }

module.exports = {
  init, listPersons, getPerson, upsertPerson, deletePerson,
  recordScreening, duePersons, deriveIdentity, guessForeign,
  getSettings, setSettings, getSeco, setSeco, dbFilePath, dataDir
};
