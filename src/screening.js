'use strict';

// ─── Screening-Orchestrator ───────────────────────────────────────────────────
// Prüft eine Person gegen SECO (immer) und dilisense (nur Ausländer / falls Key).
// Ergebnisstatus:  clear  = keine Treffer
//                  review = Treffer gefunden → muss von Mensch geprüft werden
//                  error  = eine Quelle nicht verfügbar (Ergebnis unvollständig)

const seco = require('./seco');
const dilisense = require('./dilisense');
const match = require('./match');

function newId() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// person: DB-Record mit .identity, .foreign und .clearedHits
// settings: {dilisenseApiKey, fuzzy}
async function screenPerson(person, settings) {
  const at = new Date().toISOString();
  const identity = person.identity || {};
  const fuzzy = settings.fuzzy !== false;
  const cleared = new Set(person.clearedHits || []);
  const birthYear = (identity.dob || '').slice(0, 4);
  const sources = [];
  const hits = [];
  const errors = [];

  // 1) SECO - immer
  if (seco.isReady()) {
    try {
      const secoHits = seco.screen(identity.screenName, { fuzzy });
      sources.push('SECO');
      for (const h of secoHits) hits.push(h);
    } catch (e) {
      errors.push('SECO: ' + e.message);
    }
  } else {
    errors.push('SECO-Liste nicht geladen - bitte in Einstellungen aktualisieren.');
  }

  // 2) dilisense - für Ausländer (oder wenn erzwungen), nur mit Key
  const useDili = person.foreign || settings.forceDilisense;
  if (useDili) {
    if (settings.dilisenseApiKey) {
      try {
        const res = await dilisense.screen(identity, { apiKey: settings.dilisenseApiKey, fuzzy });
        sources.push('dilisense');
        for (const r of res.records) hits.push(r);
      } catch (e) {
        errors.push('dilisense: ' + e.message);
      }
    } else {
      errors.push('dilisense übersprungen - kein API-Key hinterlegt (Ausländer ungeprüft).');
    }
  }

  // Treffer anreichern: Whitelist-Status (False-Positive-Gedächtnis) + Geburtsjahr-Abgleich
  for (const h of hits) {
    h.key = match.hitKey(h);
    h.cleared = cleared.has(h.key);
    if (birthYear && Array.isArray(h.years) && h.years.length) {
      h.dobMatch = h.years.includes(birthYear) ? 'match' : 'mismatch';
    } else {
      h.dobMatch = 'unknown';
    }
  }
  const newHits = hits.filter(h => !h.cleared);   // bereits abgehakte nicht neu melden

  let status;
  if (newHits.length > 0) status = 'review';
  else if (errors.length > 0) status = 'error';
  else status = 'clear';

  const summary = newHits.length > 0
    ? `${newHits.length} mögliche(r) Treffer - Prüfung nötig`
    : (hits.length > 0 ? `${hits.length} Treffer, alle als geprüft markiert`
      : (errors.length > 0 ? 'Unvollständig: ' + errors[0] : 'Keine Treffer'));

  return {
    id: newId(),
    at,
    query: identity.screenName,
    secoListDate: (seco.meta() || {}).listDate || null,
    sources,
    status,
    summary,
    hits,
    newHitCount: newHits.length,
    diliUsed: sources.includes('dilisense'),
    errors
  };
}

// Alle fälligen Personen prüfen. onProgress(done,total,person) optional.
async function screenDue(store, settings, intervalDays, onProgress) {
  const due = store.duePersons(intervalDays);
  const results = [];
  let diliCalls = 0;
  for (let i = 0; i < due.length; i++) {
    const p = due[i];
    const result = await screenPerson(p, settings);
    store.recordScreening(p.id, result);
    if (result.diliUsed) diliCalls++;
    results.push({ id: p.id, name: p.identity.displayName, status: result.status, diliUsed: result.diliUsed });
    if (onProgress) onProgress(i + 1, due.length, p);
  }
  if (diliCalls > 0) store.bumpDilisenseUsage(diliCalls);
  return { checked: due.length, results, diliCalls };
}

module.exports = { screenPerson, screenDue };
