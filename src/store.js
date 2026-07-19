'use strict';

// ─── Lokaler JSON-Datenspeicher ───────────────────────────────────────────────
// Kein natives Modul (kein SQLite-Kompilieren) → läuft ohne Anpassung auf Linux
// und Windows. Speicherort: userData. Verschlüsselung at rest via Electron
// safeStorage (Windows: DPAPI, Linux: gnome-libsecret/kwallet) - DSG-konform.
// Ist keine sichere Verschlüsselung verfügbar, wird als Klartext gespeichert und
// dies über encryptionAvailable() signalisiert.

const fs = require('fs');
const path = require('path');

const ENC_MAGIC = 'KYCENC1:';   // Präfix verschlüsselter DB-Dateien

let DATA_DIR = null;
let DB_FILE = null;
let BACKUP_DIR = null;
let cache = null;
let crypto = { available: false, safeStorage: null };

function initCrypto() {
  try {
    const electron = require('electron');
    const ss = electron && electron.safeStorage;
    if (ss && ss.isEncryptionAvailable && ss.isEncryptionAvailable()) {
      crypto = { available: true, safeStorage: ss };
      return;
    }
  } catch (_) { /* kein Electron-Kontext (z. B. Test) → Klartext */ }
  crypto = { available: false, safeStorage: null };
}

function init(userDataDir) {
  DATA_DIR = userDataDir;
  DB_FILE = path.join(DATA_DIR, 'kyc-datenbank.json');
  BACKUP_DIR = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  initCrypto();
  load();
  rotateBackup();
  return DB_FILE;
}

function emptyDb() {
  return {
    schemaVersion: 2,
    persons: [],
    archivedPersons: [],   // gelöschte Personen werden hier aufbewahrt (GwG Art. 7)
    settings: {
      // Vorkonfigurierter Firmen-Key (interne App, 3 Nutzer; bei Missbrauch im
      // dilisense-Konto rotieren). In den Einstellungen überschreibbar.
      dilisenseApiKey: 'UfdC71j1jq6kjm4l7xDKG2zkNItwxaEoiRYNwP5e',
      secoUrl: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=de&action=downloadXmlGesamtlisteAction',
      screeningIntervalDays: 7,
      fuzzy: true,
      theme: 'light'
    },
    seco: { lastDownload: null, listDate: null, entryCount: 0 },
    amlReports: [],
    amlLinks: {},   // customerRef (ATM-Kunden-ID-Kürzel) → personId (KYC-Dossier)
    dilisenseUsage: { month: '', count: 0 },   // Gratis-Kontingent 100/Monat
    meta: { createdAt: new Date().toISOString() }
  };
}

// ── Ver-/Entschlüsselung ──────────────────────────────────────────────────────
function serialize(obj) {
  const json = JSON.stringify(obj, null, 2);
  if (crypto.available) {
    const enc = crypto.safeStorage.encryptString(json);   // Buffer
    return ENC_MAGIC + enc.toString('base64');
  }
  return json;
}
function deserialize(raw) {
  if (raw.startsWith(ENC_MAGIC)) {
    if (!crypto.available) throw new Error('DB ist verschlüsselt, aber safeStorage nicht verfügbar.');
    const buf = Buffer.from(raw.slice(ENC_MAGIC.length), 'base64');
    return JSON.parse(crypto.safeStorage.decryptString(buf));
  }
  return JSON.parse(raw);   // Klartext (Legacy / kein safeStorage)
}

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      cache = deserialize(fs.readFileSync(DB_FILE, 'utf-8'));
      const def = emptyDb();
      cache.settings = Object.assign(def.settings, cache.settings || {});
      cache.seco = Object.assign(def.seco, cache.seco || {});
      if (!Array.isArray(cache.persons)) cache.persons = [];
      if (!Array.isArray(cache.archivedPersons)) cache.archivedPersons = [];
      if (!Array.isArray(cache.amlReports)) cache.amlReports = [];
      if (!cache.dilisenseUsage) cache.dilisenseUsage = def.dilisenseUsage;
      if (!cache.amlLinks) cache.amlLinks = {};
      // Bestehende Installationen ohne Key erhalten den Firmen-Key
      if (!cache.settings.dilisenseApiKey) cache.settings.dilisenseApiKey = def.settings.dilisenseApiKey;
      // Legacy-Klartext-DB einmalig verschlüsselt neu schreiben
      if (crypto.available) persist();
    } else {
      cache = emptyDb();
      persist();
    }
  } catch (e) {
    if (fs.existsSync(DB_FILE)) {
      const bak = DB_FILE + '.corrupt-' + Date.now();
      try { fs.copyFileSync(DB_FILE, bak); } catch (_) {}
    }
    cache = emptyDb();
    persist();
  }
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, serialize(cache), 'utf-8');
  fs.renameSync(tmp, DB_FILE);
}

// Rotierendes Backup beim Start (letzte 7 Stände)
function rotateBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `kyc-datenbank-${stamp}.bak`));
    const baks = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.bak')).sort();
    while (baks.length > 7) { try { fs.unlinkSync(path.join(BACKUP_DIR, baks.shift())); } catch (_) {} }
  } catch (_) { /* Backup ist best-effort */ }
}

function uid() { return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

// ─── Personen ─────────────────────────────────────────────────────────────────
function listPersons() { return cache.persons.slice(); }
function getPerson(id) { return cache.persons.find(p => p.id === id) || null; }
function listArchived() { return (cache.archivedPersons || []).slice(); }

function deriveIdentity(kyc) {
  const d = kyc || {};
  if (d.vp_typ === 'jp') return { kind: 'entity', displayName: d.jp_firma || '', screenName: d.jp_firma || '', dob: '', nationality: '', country: d.jp_ort || '' };
  if (d.vp_typ === 'eu') return { kind: 'entity', displayName: d.eu_firma || '', screenName: d.eu_firma || '', dob: '', nationality: '', country: d.eu_ort || '' };
  const name = [d.np_vorname, d.np_name].filter(Boolean).join(' ').trim();
  return { kind: 'individual', displayName: name, screenName: name, dob: d.np_geburtsdatum || '', nationality: d.np_staatsangehoerigkeit || '', country: d.np_ort || '' };
}

function guessForeign(kyc) {
  const nat = (kyc && kyc.np_staatsangehoerigkeit || '').toLowerCase().trim();
  if (!nat) return false;
  // Wortgrenzen! Sonst gilt "Chile"/"China" wegen des Teilstrings "ch" als Schweiz.
  return !/(^|[\s,/])(schweiz|schweizerin?|switzerland|swiss|ch)($|[\s,/.])/.test(nat);
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
    id: uid(), createdAt: now, updatedAt: now,
    kyc: person.kyc || {}, identity,
    foreign: person.foreign != null ? person.foreign : guessForeign(person.kyc),
    lastScreenedAt: null, screeningStatus: 'never', screeningSummary: '',
    screenings: [],
    clearedHits: []   // vom Menschen als False-Positive abgehakte Treffer (hitKeys)
  };
  cache.persons.push(rec);
  persist();
  return rec;
}

// Kandidat für Duplikat suchen (Name + Geburtsdatum, sonst GwG-File-Nr.)
function findDuplicate(kyc) {
  const id = deriveIdentity(kyc);
  const name = (id.displayName || '').toLowerCase().trim();
  if (!name) return null;
  const dob = id.dob || '';
  const gwg = (kyc.gwg_file_nr || '').toLowerCase().trim();
  return cache.persons.find(p => {
    const pid = p.identity || {};
    if (gwg && (p.kyc && (p.kyc.gwg_file_nr || '').toLowerCase().trim()) === gwg) return true;
    return (pid.displayName || '').toLowerCase().trim() === name && (pid.dob || '') === dob;
  }) || null;
}

// Löschen = Archivieren (Aufbewahrungspflicht GwG Art. 7, 10 Jahre)
function deletePerson(id) {
  const idx = cache.persons.findIndex(p => p.id === id);
  if (idx === -1) return false;
  const [rec] = cache.persons.splice(idx, 1);
  rec.archivedAt = new Date().toISOString();
  cache.archivedPersons = cache.archivedPersons || [];
  cache.archivedPersons.push(rec);
  persist();
  return true;
}

function recordScreening(id, result) {
  const p = getPerson(id);
  if (!p) return null;
  p.lastScreenedAt = result.at;
  p.screeningStatus = result.status;
  p.screeningSummary = result.summary || '';
  p.screenings = p.screenings || [];
  p.screenings.unshift(result);
  // Verlauf NICHT kappen (Nachweispflicht). Nur Rohdaten-Ballon vermeiden ist unnötig
  // bei wenigen Personen; volle Historie bleibt erhalten.
  persist();
  return p;
}

// Aktuelle Treffer als geprüft/ok abhaken → hitKeys merken, Status auf clear
function clearPersonHits(id, hitKeys) {
  const p = getPerson(id);
  if (!p) return null;
  p.clearedHits = Array.from(new Set([...(p.clearedHits || []), ...(hitKeys || [])]));
  p.screeningStatus = 'clear';
  p.screeningSummary = 'Manuell als geprüft/ok markiert';
  persist();
  return p;
}

function duePersons(intervalDays) {
  const days = intervalDays || cache.settings.screeningIntervalDays || 7;
  const cutoff = Date.now() - days * 86400000;
  return cache.persons.filter(p => {
    if (!p.lastScreenedAt) return true;
    return new Date(p.lastScreenedAt).getTime() < cutoff;
  });
}

// ─── Einstellungen / SECO / dilisense-Kontingent ──────────────────────────────
function getSettings() { return Object.assign({}, cache.settings); }
function setSettings(patch) { cache.settings = Object.assign({}, cache.settings, patch || {}); persist(); return getSettings(); }
function getSeco() { return Object.assign({}, cache.seco); }
function setSeco(patch) { cache.seco = Object.assign({}, cache.seco, patch || {}); persist(); return getSeco(); }

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function getDilisenseUsage() {
  const u = cache.dilisenseUsage || { month: '', count: 0 };
  if (u.month !== currentMonth()) return { month: currentMonth(), count: 0 };
  return { month: u.month, count: u.count };
}
function bumpDilisenseUsage(n) {
  const m = currentMonth();
  let u = cache.dilisenseUsage || { month: m, count: 0 };
  if (u.month !== m) u = { month: m, count: 0 };
  u.count += (n || 1);
  cache.dilisenseUsage = u;
  persist();
  return u;
}

// ─── AML-Auswertungen ─────────────────────────────────────────────────────────
function listAmlReports() { return (cache.amlReports || []).slice(); }
function saveAmlReport(report) {
  const now = new Date().toISOString();
  cache.amlReports = cache.amlReports || [];
  const label = report.label || (report.periodTo ? report.periodTo.slice(0, 4) : String(cache.amlReports.length + 1));
  const rec = Object.assign({ id: 'aml_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), savedAt: now, label }, report);
  cache.amlReports.unshift(rec);
  persist();
  return rec;
}
function deleteAmlReport(id) {
  const idx = (cache.amlReports || []).findIndex(r => r.id === id);
  if (idx === -1) return false;
  cache.amlReports.splice(idx, 1);
  persist();
  return true;
}

// AML↔KYC-Verknüpfung
function getAmlLinks() { return Object.assign({}, cache.amlLinks || {}); }
function setAmlLink(customerRef, personId) {
  cache.amlLinks = cache.amlLinks || {};
  if (personId) cache.amlLinks[customerRef] = personId;
  else delete cache.amlLinks[customerRef];
  persist();
  return getAmlLinks();
}

function dbFilePath() { return DB_FILE; }
function dataDir() { return DATA_DIR; }
function encryptionAvailable() { return crypto.available; }

module.exports = {
  init, listPersons, getPerson, listArchived, upsertPerson, deletePerson, findDuplicate,
  recordScreening, clearPersonHits, duePersons, deriveIdentity, guessForeign,
  getSettings, setSettings, getSeco, setSeco, dbFilePath, dataDir, encryptionAvailable,
  getDilisenseUsage, bumpDilisenseUsage,
  listAmlReports, saveAmlReport, deleteAmlReport,
  getAmlLinks, setAmlLink
};
