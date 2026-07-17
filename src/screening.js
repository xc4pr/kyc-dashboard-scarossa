'use strict';

// ─── Screening-Orchestrator ───────────────────────────────────────────────────
// Prüft eine Person gegen SECO (immer) und dilisense (nur Ausländer / falls Key).
// Ergebnisstatus:  clear  = keine Treffer
//                  review = Treffer gefunden → muss von Mensch geprüft werden
//                  error  = eine Quelle nicht verfügbar (Ergebnis unvollständig)

const seco = require('./seco');
const dilisense = require('./dilisense');

function newId() { return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// person: DB-Record mit .identity und .foreign
// settings: {dilisenseApiKey, fuzzy}
async function screenPerson(person, settings) {
  const at = new Date().toISOString();
  const identity = person.identity || {};
  const fuzzy = settings.fuzzy !== false;
  const sources = [];
  const hits = [];
  const errors = [];

  // 1) SECO — immer
  if (seco.isReady()) {
    try {
      const secoHits = seco.screen(identity.screenName, { fuzzy });
      sources.push('SECO');
      for (const h of secoHits) hits.push(h);
    } catch (e) {
      errors.push('SECO: ' + e.message);
    }
  } else {
    errors.push('SECO-Liste nicht geladen — bitte in Einstellungen aktualisieren.');
  }

  // 2) dilisense — für Ausländer (oder wenn erzwungen), nur mit Key
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
      errors.push('dilisense übersprungen — kein API-Key hinterlegt (Ausländer ungeprüft).');
    }
  }

  let status;
  if (hits.length > 0) status = 'review';
  else if (errors.length > 0) status = 'error';
  else status = 'clear';

  const summary = hits.length > 0
    ? `${hits.length} möglliche(r) Treffer — Prüfung nötig`
    : (errors.length > 0 ? 'Unvollständig: ' + errors[0] : 'Keine Treffer');

  return {
    id: newId(),
    at,
    query: identity.screenName,
    sources,
    status,
    summary: summary.replace('möglliche', 'mögliche'),
    hits,
    errors
  };
}

// Alle fälligen Personen prüfen. onProgress(done,total,person) optional.
async function screenDue(store, settings, intervalDays, onProgress) {
  const due = store.duePersons(intervalDays);
  const results = [];
  for (let i = 0; i < due.length; i++) {
    const p = due[i];
    const result = await screenPerson(p, settings);
    store.recordScreening(p.id, result);
    results.push({ id: p.id, name: p.identity.displayName, status: result.status });
    if (onProgress) onProgress(i + 1, due.length, p);
  }
  return { checked: due.length, results };
}

module.exports = { screenPerson, screenDue };
