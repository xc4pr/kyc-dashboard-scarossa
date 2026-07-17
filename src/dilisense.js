'use strict';

// ─── dilisense-API (internationales Sanktions-/PEP-/Kriminal-Screening) ────────
// Für Ausländer. REST-API, GET, JSON. Auth via Header x-api-key.
//   Einzelperson: GET https://api.dilisense.com/v1/checkIndividual
//   Firma/Entity: GET https://api.dilisense.com/v1/checkEntity
// Parameter: names (Pflicht), fuzzy_search=1|2, dob=TT/MM/JJJJ (optional), gender,
//            includes (Quellenfilter). Gratis-Kontingent 100 Prüfungen/Monat.
// Antwort: { timestamp, total_hits, found_records: [ {name, entity_type, source_type,
//            source_id, pep_type, gender, date_of_birth[], alias_names[], citizenship[],
//            sanction_details[] } ] }

const BASE = 'https://api.dilisense.com/v1';

function toDilisenseDob(iso) {
  // iso yyyy-mm-dd  →  dd/mm/yyyy
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

async function call(endpoint, params, apiKey) {
  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'x-api-key': apiKey, 'Accept': 'application/json' }
  });
  const bodyText = await resp.text();
  let json;
  try { json = JSON.parse(bodyText); } catch (_) { json = null; }
  if (!resp.ok) {
    const msg = (json && (json.message || json.error)) || bodyText.slice(0, 200) || ('HTTP ' + resp.status);
    const err = new Error('dilisense: ' + msg);
    err.status = resp.status;
    throw err;
  }
  return json || { total_hits: 0, found_records: [] };
}

function mapRecords(json) {
  const recs = (json && json.found_records) || [];
  return recs.map(r => ({
    source: 'dilisense',
    source_type: r.source_type || 'OTHER',   // SANCTION | PEP | CRIMINAL | OTHER
    name: r.name || '',
    entity_type: r.entity_type || '',
    source_id: r.source_id || '',
    pep_type: r.pep_type || '',
    gender: r.gender || '',
    dob: Array.isArray(r.date_of_birth) ? r.date_of_birth.join(', ') : (r.date_of_birth || ''),
    aliases: Array.isArray(r.alias_names) ? r.alias_names.slice(0, 5) : [],
    citizenship: Array.isArray(r.citizenship) ? r.citizenship.join(', ') : (r.citizenship || ''),
    details: Array.isArray(r.sanction_details) ? r.sanction_details.slice(0, 3) : []
  }));
}

// Person prüfen. identity = {kind, screenName, dob, nationality}
async function screen(identity, opts) {
  const apiKey = opts && opts.apiKey;
  if (!apiKey) { const e = new Error('Kein dilisense API-Key hinterlegt.'); e.code = 'NO_KEY'; throw e; }
  const fuzzy = (opts && opts.fuzzy !== false) ? 1 : 0;
  const name = (identity.screenName || '').trim();
  if (!name) return { total_hits: 0, records: [] };

  const endpoint = identity.kind === 'entity' ? '/checkEntity' : '/checkIndividual';
  const params = { names: name };
  if (fuzzy) params.fuzzy_search = fuzzy;
  if (identity.kind !== 'entity' && identity.dob) {
    const d = toDilisenseDob(identity.dob);
    if (d) params.dob = d;
  }

  const json = await call(endpoint, params, apiKey);
  return { total_hits: json.total_hits || 0, records: mapRecords(json) };
}

// Kurzer Verbindungstest für die Einstellungen (1 Prüfung des Kontingents)
async function testKey(apiKey) {
  const json = await call('/checkIndividual', { names: 'Vladimir Putin', fuzzy_search: 1 }, apiKey);
  return { ok: true, total_hits: json.total_hits || 0 };
}

module.exports = { screen, testKey, toDilisenseDob };
