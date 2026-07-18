'use strict';

// ─── Namensnormalisierung & Abgleich ──────────────────────────────────────────
// Grundsatz Compliance: lieber ein Treffer zu viel (zur manuellen Prüfung) als
// ein Treffer zu wenig. Ein Treffer wird NIE automatisch als "sauber" verworfen –
// er wird zur menschlichen Kontrolle markiert.

function normalize(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // Diakritika entfernen (ä→a, é→e)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')      // Satzzeichen → Leerzeichen
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  const n = normalize(s);
  if (!n) return [];
  // sehr kurze Tokens (Initialen, Bindewörter) ignorieren
  return n.split(' ').filter(t => t.length >= 2);
}

// Levenshtein-Distanz (klein, iterativ)
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// Erlaubte Fuzzy-Distanz je nach Tokenlänge
function fuzzyDist(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// Findet ein Query-Token in einer Liste von Kandidaten-Tokens (exakt oder fuzzy)
function tokenMatches(qt, candTokens, fuzzy) {
  for (const ct of candTokens) {
    if (ct === qt) return true;
    if (ct.includes(qt) && qt.length >= 4) return true;   // Teilstring
    if (fuzzy) {
      const d = fuzzyDist(Math.max(qt.length, ct.length));
      if (d > 0 && lev(qt, ct) <= d) return true;
    }
  }
  return false;
}

// Vergleicht einen gesuchten Namen mit EINEM Kandidatennamen (z. B. ein Alias).
// Rückgabe: {score 0..1, matched:boolean}
function scoreName(queryName, candidateName, fuzzy) {
  const qt = tokens(queryName);
  const ct = tokens(candidateName);
  if (qt.length === 0 || ct.length === 0) return { score: 0, matched: false };

  let hit = 0;
  for (const t of qt) if (tokenMatches(t, ct, fuzzy)) hit++;
  const ratio = hit / qt.length;

  // Als Treffer werten, wenn ALLE Query-Tokens (Vor- + Nachname) gefunden werden.
  // Bei nur einem Token (Firmenname/Einzelname) exakter Vollmatch nötig.
  let matched = false;
  if (qt.length >= 2) matched = (hit === qt.length);
  else matched = ct.includes(qt[0]);

  return { score: ratio, matched };
}

// Vergleicht gesuchten Namen gegen MEHRERE Kandidatennamen (Hauptname + Aliase).
// Rückgabe bestes Ergebnis.
function scoreAgainstMany(queryName, candidateNames, fuzzy) {
  let best = { score: 0, matched: false, via: '' };
  for (const cn of candidateNames) {
    const r = scoreName(queryName, cn, fuzzy);
    if (r.matched && !best.matched) best = { score: r.score, matched: true, via: cn };
    else if (r.matched && r.score > best.score) best = { score: r.score, matched: true, via: cn };
    else if (!best.matched && r.score > best.score) best = { score: r.score, matched: false, via: cn };
  }
  return best;
}

// Stabiler Schlüssel eines Treffers (für False-Positive-Whitelist pro Person)
function hitKey(h) {
  const id = h.ssid || h.source_id || '';
  return `${h.source || ''}:${id}:${normalize(h.name)}`;
}

module.exports = { normalize, tokens, lev, scoreName, scoreAgainstMany, hitKey };
