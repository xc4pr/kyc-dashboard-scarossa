'use strict';

// ─── E2E-/Bug-Bounty-Suite ────────────────────────────────────────────────────
// Fährt die echte App (Sandbox, CSP, Partial) durch Nutzer-Szenarien inkl.
// bewusst "dummer" Eingaben. Start: KYC_E2E=1 electron . --user-data-dir=<frisch>
// Ausgabe: E2E_RESULT={...} auf stdout. Dialoge (confirm/alert) werden gestubbt.

const PAGE_SUITE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const el = document.querySelector('[x-data]');
  const d = Alpine.$data(el);
  const R = { pass: [], fail: [] };
  const ok = (name, cond, extra) => (cond ? R.pass : R.fail).push(name + (extra ? ' :: ' + extra : ''));
  window.confirm = () => true;           // Dialoge stubben (Headless)
  window.alert = () => {};

  // ── 1) Leeres Formular speichern → Validierung greift, nichts gespeichert ──
  d.newPerson(); d.data.filler_name = ''; d.data.filler_datum = ''; d.data.gwg_file_nr = '';
  await d.savePerson(); await sleep(150);
  ok('validation-blocks-empty', d.validationErrors.length >= 3 && d.persons.length === 0, 'errs=' + d.validationErrors.length);
  ok('validation-marks-red', document.querySelectorAll('.invalid').length >= 3);
  ok('validation-scrolls-section', d.activeSection === 'stammdaten', d.activeSection);

  // ── 2) Vorschau bei invalidem Formular blockiert ──
  d.openExportPreview(); await sleep(50);
  ok('preview-blocked-invalid', !d.exportPreview);

  // ── 3) Minimal gültige NP speichern ──
  const fill = () => { Object.assign(d.data, { filler_name: 'Tester', filler_datum: '2026-07-19', gwg_file_nr: '2026-001',
    np_vorname: 'Max', np_name: 'Muster', np_geburtsdatum: '1990-01-01', np_staatsangehoerigkeit: 'Schweiz',
    np_strasse: 'Weg 1', np_plz: '8000', np_ort: 'Zürich' }); };
  d.newPerson(); fill();
  await d.savePerson(); await sleep(150);
  ok('save-valid-np', d.persons.length === 1 && !document.querySelector('.invalid'));

  // ── 4) Doppelklick-Race: 2× speichern parallel → nur 1 Person ──
  d.newPerson(); fill(); d.data.np_vorname = 'Race'; d.data.gwg_file_nr = '2026-002';
  await Promise.all([d.savePerson(), d.savePerson()]); await sleep(200);
  ok('no-doubleclick-duplicate', d.persons.filter(p => p.identity.displayName === 'Race Muster').length === 1);

  // ── 5) Round-Trip: JEDES Feld gesetzt → speichern → öffnen → identisch ──
  d.newPerson();
  const def = window.KYC.defaultData();
  for (const [k, v] of Object.entries(def)) {
    if (k === 'vp_typ') { d.data[k] = 'np'; continue; }
    if (typeof v === 'boolean') d.data[k] = true;
    else if (typeof v === 'number') d.data[k] = 2;
    else if (v === null) d.data[k] = 1;
    else if (/datum|geburts/.test(k)) d.data[k] = '2001-02-03';
    else d.data[k] = 'T_' + k;
  }
  fill(); d.data.np_vorname = 'Round'; d.data.gwg_file_nr = '2026-003';
  // 'NP selber' würde die WB-Felder absichtlich überschreiben (Auto-Übernahme) —
  // für den Persistenz-Test deaktivieren und WB-Werte danach erneut setzen.
  d.data.wb_typ_np_selber = false; await sleep(120);
  for (const k of ['wb_name','wb_vorname','wb_nationalitaet','wb_strasse']) d.data[k] = 'T_' + k;
  d.data.wb_geburtsdatum = '2001-02-03';
  await d.savePerson(); await sleep(150);
  const saved = d.persons.find(p => p.identity.displayName.includes('Round'));
  d.openPerson(saved.id); await sleep(100);
  const bad = [];
  for (const k of Object.keys(def)) {
    if (k === 'wb_typ_np_selber') { if (d.data[k] !== false) bad.push(k); continue; }
    const want = k === 'vp_typ' ? 'np'
      : (k === 'np_vorname' ? 'Round' : (['filler_name','filler_datum','gwg_file_nr','np_name','np_geburtsdatum','np_staatsangehoerigkeit','np_strasse','np_plz','np_ort'].includes(k) ? d.data[k]
      : (typeof def[k] === 'boolean' ? true : (typeof def[k] === 'number' ? 2 : (def[k] === null ? 1 : (/datum|geburts/.test(k) ? '2001-02-03' : 'T_' + k))))));
    if (JSON.stringify(d.data[k]) !== JSON.stringify(want)) bad.push(k);
  }
  ok('roundtrip-all-fields', bad.length === 0, bad.slice(0, 5).join(','));

  // ── 6) XSS: HTML im Namen darf nirgends ausgeführt/gerendert werden ──
  d.newPerson(); fill();
  d.data.np_vorname = '<img src=x onerror="window.__xss=1">'; d.data.np_name = '<b>fett</b>'; d.data.gwg_file_nr = '2026-004';
  await d.savePerson(); await sleep(200);
  d.view = 'persons'; await sleep(250);
  d.view = 'database'; await sleep(250);
  ok('xss-not-executed', !window.__xss);
  ok('xss-not-injected', !document.querySelector('img[src="x"]') && !document.querySelector('.row-name b'));

  // ── 7) WB-Übernahme (Kürzung) ──
  d.newPerson(); fill();
  d.data.wb_typ_np_selber = true; await sleep(100);
  ok('wb-autofill', d.data.wb_name === 'Muster' && d.data.wb_vorname === 'Max' && d.data.wb_plz === '8000');

  // ── 8) dilisense-Vorschlag: DE→ja, Chile→ja (Wortgrenze!), Schweiz→nein ──
  d.newPerson(); fill();
  d.data.np_staatsangehoerigkeit = 'Deutschland'; await sleep(900);
  ok('dili-suggest-de', d.diliSuggest === true);
  d.acceptDili();
  ok('dili-accept-sets-foreign', d.foreign === true && d.diliSuggest === false);
  d.newPerson(); fill(); d.data.np_staatsangehoerigkeit = 'Chile'; await sleep(900);
  ok('dili-suggest-chile', d.diliSuggest === true);
  d.newPerson(); fill(); d.data.np_staatsangehoerigkeit = 'Schweiz'; await sleep(900);
  ok('dili-no-suggest-ch', d.diliSuggest === false);

  // ── 9) Vorschau enthält alle 4 Formulare + eingegebene Werte ──
  d.newPerson(); fill(); d.data.gwg_file_nr = '2026-005';
  d.openExportPreview(); await sleep(100);
  const pv = d.exportPreview || '';
  ok('preview-has-4-forms', ['902.1', '902.4', '902.5', '902.9'].every(t => pv.includes(t)));
  ok('preview-has-values', pv.includes('Muster') && pv.includes('2026-005'));
  ok('preview-escapes-html', !pv.includes('<img'));
  d.exportPreview = null;

  // ── 10) Extremwerte: 10'000 Zeichen, Emoji, Umlaute, Zeilenumbrüche ──
  d.newPerson(); fill();
  d.data.np_vorname = 'A'.repeat(10000); d.data.np_name = '🚀Ünïcode\\nZeile2'; d.data.gwg_file_nr = '2026-006';
  await d.savePerson(); await sleep(150);
  ok('extreme-input-saved', d.persons.some(p => (p.kyc.np_vorname || '').length === 10000));

  // ── 11) Suche mit Regex-Sonderzeichen crasht nicht ──
  d.query = '((('; const n1 = d.filteredPersons.length;
  d.query = '🚀'; const n2 = d.filteredPersons.length;
  d.query = '';
  ok('search-special-chars', n1 === 0 && n2 >= 1);

  // ── 12) Import: Schrott-Datei crasht nicht, wird gemeldet ──
  try {
    const junk = new File([new Uint8Array([1, 2, 3, 4])], 'kaputt.docx');
    await d.importFiles([junk]); await sleep(100);
    ok('import-junk-handled', true);
  } catch (e) { ok('import-junk-handled', false, e.message); }

  // ── 13) Import-Duplikat: gleiche Person → aktualisieren statt doppelt ──
  try {
    const cnt = d.persons.length;
    const zipAb = await window.KYC.buildZip(plainCopy(d.persons[0].kyc), d.fieldMap);
    const f = new File([zipAb], 'GwG_dup.zip');
    await d.importFiles([f]); await sleep(200);
    ok('import-dup-updates', d.persons.length === cnt, cnt + '→' + d.persons.length);
  } catch (e) { ok('import-dup-updates', false, e.message); }
  function plainCopy(x) { return JSON.parse(JSON.stringify(x)); }

  // ── 13b) Teilimport: nur 2 von 4 Formularen → Nachfrage, Import mit Markierung ──
  try {
    const pd = mkData({ np_vorname: 'Partial', np_name: 'Person', gwg_file_nr: '2026-777', kp_beruf: 'Bäcker' });
    const fullAb = await window.KYC.buildZip(pd, d.fieldMap);
    const z = await JSZip.loadAsync(fullAb);
    const part = new JSZip();
    part.file('902.1.docx', await z.file('902.1.docx').async('arraybuffer'));
    part.file('902.9.docx', await z.file('902.9.docx').async('arraybuffer'));
    const partAb = await part.generateAsync({ type: 'arraybuffer' });
    await d.importFiles([new File([partAb], 'GwG_partial.zip')]); await sleep(200);
    const pp = d.persons.find(p => p.identity.displayName === 'Partial Person');
    ok('partial-import-saved', !!pp);
    ok('partial-import-marked', pp && pp.missingForms && pp.missingForms.length === 2 && pp.missingForms.includes('902.4'), pp && (pp.missingForms || []).join(','));
    ok('partial-no-904-data', pp && !pp.kyc.kp_beruf, 'kp_beruf=' + (pp && pp.kyc.kp_beruf));

    // ── 13c) Nachimport des vollständigen ZIPs → zusammenführen, Markierung weg ──
    const cnt = d.persons.length;
    await d.importFiles([new File([fullAb], 'GwG_full.zip')]); await sleep(200);
    const pp2 = d.persons.find(p => p.identity.displayName === 'Partial Person');
    ok('merge-no-duplicate', d.persons.length === cnt);
    ok('merge-completes', pp2 && (pp2.missingForms || []).length === 0 && pp2.kyc.kp_beruf === 'Bäcker');

    // ── 13d) Keine Vermischung: abweichender Wert behält bestehenden Stand ──
    const pd2 = mkData({ np_vorname: 'Partial', np_name: 'Person', gwg_file_nr: '2026-777', kp_beruf: 'Metzger', kp_zweck: 'NEU' });
    const conflictAb = await window.KYC.buildZip(pd2, d.fieldMap);
    await d.importFiles([new File([conflictAb], 'GwG_conflict.zip')]); await sleep(200);
    const pp3 = d.persons.find(p => p.identity.displayName === 'Partial Person');
    ok('merge-keeps-existing', pp3 && pp3.kyc.kp_beruf === 'Bäcker', 'kp_beruf=' + (pp3 && pp3.kyc.kp_beruf));
    ok('merge-fills-empty', pp3 && pp3.kyc.kp_zweck === 'NEU');
  } catch (e) { ok('partial-import-saved', false, e.message); }
  function mkData(o) { return Object.assign(window.KYC.defaultData(), { vp_typ: 'np', filler_name: 'T', filler_datum: '2026-07-19',
    np_geburtsdatum: '1970-01-01', np_staatsangehoerigkeit: 'Schweiz', np_strasse: 'W 1', np_plz: '8000', np_ort: 'Zürich' }, o); }

  // ── 14) AML: Schrott-CSV → klare Fehlermeldung, kein Crash ──
  const amlErr = await window.api.aml.analyze({ text: 'foo;bar\\n1;2\\n', name: 'x.csv' }).then(() => '').catch(e => e.message);
  ok('aml-bad-csv-message', amlErr.includes('CSV nicht erkannt'));

  // ── 15) Screening ohne SECO-Liste → Fehlerstatus statt Crash ──
  try {
    const r = await window.api.screening.person(d.persons[0].id); await sleep(50);
    ok('screening-no-seco-graceful', r.status === 'error' && (r.errors || []).length > 0);
  } catch (e) { ok('screening-no-seco-graceful', false, e.message); }

  // ── 16) Datenbank: Mehrfach-Auswahl archivieren + Report-Löschung ──
  await d.reload();
  const before = d.persons.length;
  d.view = 'database'; d.dbManage = true;
  d.selPersons = {}; d.selPersons[d.persons[before - 1].id] = true;
  await d.deleteSelectedPersons(); await sleep(150);
  ok('db-archive-selected', d.persons.length === before - 1);
  await window.api.aml.save({ label: 'T', periodFrom: '2025-01-01', periodTo: '2025-12-31', agg: { kpis: { completed: 1, cancelled: 0, uniqueCustomers: 1, totalVolume: 1 }, gwg: { pflichtig: 0, frei: 1, exactThreshold: 0 }, gwgList: [], buckets: [], monthly: [], machines: [], cashIn: {count:1,sum:1}, cashOut: {count:0,sum:0} } });
  await d.amlLoadList();
  const rep = d.amlReports.length;
  d.selReports = {}; d.selReports[d.amlReports[0].id] = true;
  await d.deleteSelectedReports(); await sleep(100);
  ok('db-delete-report', d.amlReports.length === rep - 1);

  // ── 16b) Archiv: nur einsehen & wiederherstellen, kein Löschen ──
  const beforeArch = d.persons.length;
  const victim = d.persons[0];
  await window.api.persons.remove(victim.id); await d.reload();
  await d.openArchive();
  ok('archive-visible', d.dbTab === 'archive' && d.archived.some(p => p.id === victim.id));
  ok('archive-no-purge-api', !window.api.persons.purge && !window.api.persons.deleteArchived);
  await d.restoreFromArchive(d.archived.find(p => p.id === victim.id));
  ok('archive-restore', d.persons.length === beforeArch && d.archived.every(p => p.id !== victim.id));
  d.dbTab = 'active';

  // ── 17) Dirty-Guard: Formular ändern → navTo fragt (confirm=true lässt durch) ──
  d.newPerson(); d.data.np_vorname = 'Dirty';
  d.navTo('dashboard');
  ok('dirty-guard-allows-after-confirm', d.view === 'dashboard');

  // ── 18) Theme-Toggle rundum ──
  const t0 = d.theme; d.toggleTheme(); const t1 = d.theme; d.toggleTheme();
  ok('theme-toggle', t0 !== t1 && d.theme === t0);

  return JSON.stringify({ pass: R.pass.length, fail: R.fail.length, failures: R.fail });
})()`;

async function run(win) {
  return win.webContents.executeJavaScript(PAGE_SUITE);
}

module.exports = { run };
