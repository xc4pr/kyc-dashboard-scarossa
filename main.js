'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./src/store');
const seco = require('./src/seco');
const dilisense = require('./src/dilisense');
const screening = require('./src/screening');
const scheduler = require('./src/scheduler');
const aml = require('./src/aml');

// Schweizer Locale erzwingen → native Datumsfelder zeigen TT.MM.JJJJ statt mm/dd/yyyy
app.commandLine.appendSwitch('lang', 'de-CH');

const HEADLESS = process.argv.includes('--screen');

// Ressourcenpfade (Dev vs. installiert)
function resourcePath(rel) {
  if (app.isPackaged) return path.join(process.resourcesPath, rel);
  return path.join(__dirname, rel);
}

function initData() {
  const dataDir = app.getPath('userData');
  store.init(dataDir);
  seco.init(dataDir);
}

// HTML → PDF (A4) über ein unsichtbares Fenster
async function htmlToPdf(html, opts) {
  const landscape = !opts || opts.landscape !== false;
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await w.webContents.printToPDF({ landscape, printBackground: true, pageSize: 'A4' });
  } finally {
    w.destroy();
  }
}

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Screening-Nachweis (A4 hoch) für die VQF-Revision
function renderScreeningProof(p) {
  const id = p.identity || {};
  const last = (p.screenings || [])[0];
  const de = iso => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('de-CH'); } catch { return iso; } };
  const deDate = iso => { if (!iso) return '—'; const d = String(iso).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso; };
  const statusText = { clear: 'Kein Treffer (unbedenklich)', review: 'Treffer — manuelle Prüfung nötig', error: 'Unvollständig', hit: 'Treffer', never: 'Nie geprüft' }[(last && last.status) || p.screeningStatus] || '—';
  const hitsHtml = (last && last.hits && last.hits.length)
    ? last.hits.map(h => `<tr><td style="padding:5px 10px;border-bottom:1px solid #ddd;">${escHtml(h.name)}</td><td style="padding:5px 10px;border-bottom:1px solid #ddd;">${escHtml(h.source)} / ${escHtml(h.source_type || '')}</td><td style="padding:5px 10px;border-bottom:1px solid #ddd;">${escHtml((h.years || []).join(', '))}${h.dobMatch && h.dobMatch !== 'unknown' ? ' (' + (h.dobMatch === 'match' ? 'Jahr passt' : 'Jahr abweichend') + ')' : ''}</td><td style="padding:5px 10px;border-bottom:1px solid #ddd;">${h.cleared ? 'als False-Positive abgehakt' : 'offen'}</td></tr>`).join('')
    : '<tr><td colspan="4" style="padding:8px 10px;color:#1a7a3c;">Keine Treffer gegen die geprüften Listen.</td></tr>';
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
    @page { size: A4 portrait; margin: 2cm; }
    body { font-family: Arial, sans-serif; font-size: 10.5pt; color:#1a1a1a; }
    h1 { font-size:15pt; color:#003366; border-bottom:2.5px solid #003366; padding-bottom:5px; }
    .kv { padding:3px 0; } .kv b { display:inline-block; width:200px; color:#555; }
    table { border-collapse:collapse; width:100%; margin-top:8px; font-size:9.5pt; }
    th { background:#003366; color:#fff; text-align:left; padding:6px 10px; }
    .status { font-size:12pt; font-weight:bold; padding:8px 12px; border-radius:4px; display:inline-block; margin:10px 0; }
    .ok { background:#e9f8ee; color:#1a7a3c; } .warn { background:#fdeaea; color:#c0392b; }
    .foot { margin-top:26px; border-top:1px solid #ccc; padding-top:6px; font-size:8pt; color:#888; }
  </style></head><body>
  <h1>Screening-Nachweis — Sanktions-/PEP-Prüfung</h1>
  <div class="kv"><b>Person / Vertragspartei:</b> ${escHtml(id.displayName || '—')}</div>
  <div class="kv"><b>Geburtsdatum:</b> ${deDate(id.dob)}</div>
  <div class="kv"><b>Nationalität:</b> ${escHtml(id.nationality || '—')}</div>
  <div class="kv"><b>GwG-File-Nr.:</b> ${escHtml((p.kyc && p.kyc.gwg_file_nr) || '—')}</div>
  <div class="kv"><b>Geprüft am:</b> ${de(last && last.at)}</div>
  <div class="kv"><b>Geprüfte Quellen:</b> ${escHtml((last && last.sources || []).join(', ') || '—')}</div>
  <div class="kv"><b>SECO-Listenstand:</b> ${deDate(last && last.secoListDate)}</div>
  <div class="status ${(last && last.status) === 'clear' ? 'ok' : 'warn'}">Ergebnis: ${statusText}</div>
  <table><tr><th>Treffername</th><th>Quelle</th><th>Geburtsjahr(e)</th><th>Status</th></tr>${hitsHtml}</table>
  <div class="foot">Automatisch erzeugter Nachweis · KYC-Dashboard Scarossa · Erstellt: ${de(new Date().toISOString())}<br>
  Methodik: Namensabgleich (Fuzzy) gegen SECO-Sanktionsliste${(last && last.sources || []).includes('dilisense') ? ' und dilisense (Sanktionen/PEP/Kriminallisten)' : ''}. Treffer werden nie automatisch verworfen.</div>
  </body></html>`;
}

// KYC-Dossier (A4 hoch): alle erfassten Daten strukturiert als PDF
function renderKycDossier(p) {
  const d = p.kyc || {}, id = p.identity || {};
  const deDate = iso => { if (!iso) return '—'; const x = String(iso).slice(0, 10).split('-'); return x.length === 3 ? `${x[2]}.${x[1]}.${x[0]}` : iso; };
  const v = x => escHtml(x || '—');
  const yn = b => b ? 'Ja' : 'Nein';
  const row = (label, val) => `<tr><td class="l">${escHtml(label)}</td><td>${val}</td></tr>`;
  const sec = (title, rows) => rows.filter(Boolean).length
    ? `<h2>${escHtml(title)}</h2><table>${rows.filter(Boolean).join('')}</table>` : '';

  const typLabel = { np: 'Natürliche Person', eu: 'Einzelunternehmen', jp: 'Juristische Person' }[d.vp_typ] || d.vp_typ;
  let vpRows = [row('Typ', escHtml(typLabel))];
  if (d.vp_typ === 'np') vpRows.push(
    row('Name, Vorname', v([d.np_name, d.np_vorname].filter(Boolean).join(', '))),
    row('Adresse', v([d.np_strasse, [d.np_plz, d.np_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))),
    row('Geburtsdatum', deDate(d.np_geburtsdatum)), row('Staatsangehörigkeit', v(d.np_staatsangehoerigkeit)),
    row('Telefon / E-Mail', v([d.np_telefon, d.np_email].filter(Boolean).join(' / '))),
    row('Identifikationsdokument', v(d.np_identifikationsdokument)), row('Ausweiskopie beigefügt', yn(d.np_ausweiskopie_beigefuegt)));
  if (d.vp_typ === 'eu') vpRows.push(
    row('Firma', v(d.eu_firma)),
    row('Geschäftsadresse', v([d.eu_strasse, [d.eu_plz, d.eu_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))),
    row('Identifikationsdokument', v(d.eu_identifikationsdokument)));
  if (d.vp_typ === 'jp') vpRows.push(
    row('Firma', v(d.jp_firma)),
    row('Domiziladresse', v([d.jp_strasse, [d.jp_plz, d.jp_ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))),
    row('Kontaktperson', v([d.jp_kp_name, d.jp_kp_vorname].filter(Boolean).join(', '))),
    row('Telefon / E-Mail', v([d.jp_telefon, d.jp_email].filter(Boolean).join(' / '))));

  const risiko = d.risiko_mit_erhoehtem ? 'Mit erhöhtem Risiko' : 'Ohne erhöhtes Risiko';
  const pepJa = d.pep_ausl_ja || d.pep_inl_ja || d.pep_int_ja;

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
    @page { size: A4 portrait; margin: 2cm; }
    body { font-family: Arial, sans-serif; font-size: 10pt; color:#1a1a1a; }
    h1 { font-size:15pt; color:#003366; border-bottom:2.5px solid #003366; padding-bottom:5px; margin-bottom: 4px; }
    .sub { color:#777; font-size:9pt; margin-bottom: 14px; }
    h2 { font-size:10.5pt; color:#fff; background:#003366; padding:5px 10px; margin:16px 0 0; }
    table { border-collapse:collapse; width:100%; font-size:9.5pt; }
    td { padding:5px 10px; border-bottom:1px solid #e2e2e2; vertical-align: top; }
    td.l { width: 220px; color:#555; font-weight: bold; }
    .foot { margin-top:26px; border-top:1px solid #ccc; padding-top:6px; font-size:8pt; color:#888; }
  </style></head><body>
  <h1>KYC-Dossier — ${escHtml(id.displayName || '')}</h1>
  <div class="sub">GwG-File ${escHtml(d.gwg_file_nr || '—')} · VQF ${escHtml(d.vqf_mitglied_nr || '—')} · Erfasst von ${escHtml(d.filler_name || '—')} am ${deDate(d.filler_datum)}</div>
  ${sec('Vertragspartei', vpRows)}
  ${sec('Aufnahme der Geschäftsbeziehung', [
    row('Vertragsschluss', deDate(d.vertragsschluss_datum)),
    row('Aufnahmeart', escHtml([d.aufnahme_persoenlich && 'Persönlich', d.aufnahme_korrespondenz && 'Korrespondenz'].filter(Boolean).join(', ') || '—')),
    row('Embargo-Prüfung', v(d.embargo_pruefung_resultat)),
    d.weiteres ? row('Weiteres', v(d.weiteres)) : null])}
  ${sec('Wirtschaftlich Berechtigter', [
    row('Name, Vorname', v([d.wb_name, d.wb_vorname].filter(Boolean).join(', '))),
    row('Geburtsdatum / Nationalität', escHtml([deDate(d.wb_geburtsdatum), d.wb_nationalitaet].filter(x => x && x !== '—').join(' / ') || '—')),
    row('Wohnsitz', v([d.wb_strasse, [d.wb_plz, d.wb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')))])}
  ${sec('Risikoprofil (902.4)', [
    row('PEP', pepJa ? 'JA — PEP-Bezug vorhanden' : 'Nein'),
    row('High-Risk-Land', d.high_risk_ja ? 'Ja' : 'Nein'),
    row('Risikoklassifizierung', escHtml(risiko)),
    d.risiko_begruendung_abweichend ? row('Begründung', v(d.risiko_begruendung_abweichend)) : null])}
  ${sec('Kundenprofil (902.5)', [
    row('Beruf / Tätigkeit', v(d.kp_beruf)), row('Einkommen', v(d.kp_einkommen)),
    row('Eingebrachte Vermögenswerte', v(d.kp_eingebrachte_art)),
    row('Herkunft', v(d.kp_herkunft_detailliert)), row('Zweck', v(d.kp_zweck)),
    row('Geschäftsvolumen', v(d.kp_geschaeftsvolumen)),
    d.kp_sonstiges ? row('Sonstiges', v(d.kp_sonstiges)) : null])}
  ${sec('Screening-Status', [
    row('Letzte Prüfung', p.lastScreenedAt ? new Date(p.lastScreenedAt).toLocaleString('de-CH') : 'Nie'),
    row('Ergebnis', escHtml(p.screeningSummary || '—'))])}
  <div class="foot">KYC-Dossier · automatisch erzeugt · KYC-Dashboard Scarossa · ${new Date().toLocaleString('de-CH')} — Vertraulich (DSG)</div>
  </body></html>`;
}

// ─── Headless-Screening (vom OS-Zeitplan gestartet) ───────────────────────────
async function runHeadlessScreening() {
  // Nicht gleichzeitig mit offener GUI in dieselbe DB schreiben (Datenintegrität)
  if (!app.requestSingleInstanceLock()) {
    console.log('GUI-Instanz läuft — Headless-Screening übersprungen.');
    app.quit();
    return;
  }
  initData();
  const settings = store.getSettings();
  // SECO-Liste zuerst aktualisieren (sonst wird gegen alten Stand geprüft);
  // bei Netzfehler Fallback auf den gecachten Index.
  try {
    const meta = await seco.refresh(settings.secoUrl);
    store.setSeco(meta);
  } catch (e) {
    console.error('SECO-Refresh fehlgeschlagen, nutze Cache:', e.message);
  }
  const res = await screening.screenDue(store, settings, settings.screeningIntervalDays);
  const flagged = res.results.filter(r => r.status === 'review');
  const errored = res.results.filter(r => r.status === 'error');

  if (Notification.isSupported()) {
    let body;
    if (flagged.length > 0) {
      body = `${flagged.length} Person(en) mit möglichem Treffer — bitte im Dashboard prüfen.`;
    } else if (res.checked === 0) {
      body = 'Keine fälligen Personen.';
    } else {
      body = `${res.checked} Person(en) geprüft, keine Treffer.${errored.length ? ' (' + errored.length + ' unvollständig)' : ''}`;
    }
    new Notification({ title: 'KYC-Screening', body, urgency: flagged.length ? 'critical' : 'normal' }).show();
    await new Promise(r => setTimeout(r, 1500));
  }
  app.quit();
}

// ─── Hauptfenster ─────────────────────────────────────────────────────────────
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#EAE7E0',
    title: 'KYC-Dashboard Scarossa',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.autoHideMenuBar = true;   // Menü versteckt, Accelerators (Zoom, Ctrl+Q) bleiben
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Dev: AML-Ansicht mit Vorschau erfassen (nur wenn KYC_AMLSHOT gesetzt).
  if (process.env.KYC_AMLSHOT) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await win.webContents.executeJavaScript(`(async()=>{const el=document.querySelector('[x-data]');const d=(window.Alpine&&Alpine.$data)?Alpine.$data(el):el._x_dataStack[0];d.amlResult=await window.api.aml.analyze({path:${JSON.stringify(process.env.AML_CSV)},pruefer:'AML Revisions AG'});d.view='aml';return 'ok';})()`);
          await new Promise(r => setTimeout(r, 1400));
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.KYC_AMLSHOT, img.toPNG());
        } catch (e) { console.log('AMLSHOT_ERR=' + e.message); }
        app.quit();
      }, 2600);
    });
  }
  // Dev: IPC-Clone-Grenze testen (Alpine-Proxy → plain) — nur KYC_CLONETEST.
  if (process.env.KYC_CLONETEST) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const out = await win.webContents.executeJavaScript(`(async () => {
            const el = document.querySelector('[x-data]');
            const d = Alpine.$data(el);
            const r = {};
            // 1) Person über Alpine-Proxy speichern
            d.newPerson();
            d.data.np_vorname = 'Clone'; d.data.np_name = 'Test'; d.data.np_ort = 'Uster';
            await d.savePerson();
            r.personSaved = d.persons.some(p => p.identity.displayName === 'Clone Test');
            // 2) AML analysieren (echte CSV), speichern, gespeicherte rendern
            const resp = await window.api.aml.analyze({ text: 'a;b\\n1;2\\n', name: 'x' }).then(() => 'ok').catch(e => e.message);
            r.badCsvRejected = String(resp).includes('CSV nicht erkannt');
            d.amlResult = { agg: JSON.parse(${JSON.stringify(JSON.stringify(require('./src/aml').analyze(require('./src/aml').parseCsv(fs.readFileSync(process.env.AML_CSV, 'utf-8')))))}), html: '', records: 1, sourceFile: 'test.csv' };
            await d.amlSaveReport();
            r.amlSaved = d.amlReports.length > 0;
            await d.amlOpenSaved(d.amlReportsSorted[0]);
            r.renderOk = (d.amlResult.html || '').includes('AML-Revisionsunterlagen');
            // 3) Einstellungen (Proxy) speichern
            await d.saveSettings();
            r.settingsOk = true;
            return JSON.stringify(r);
          })()`);
          console.log('CLONETEST=' + out);
        } catch (e) { console.log('CLONETEST_ERR=' + e.message); }
        app.quit();
      }, 2800);
    });
  }
  // Dev-Selbsttest des Import-Round-Trips (nur wenn KYC_SELFTEST gesetzt).
  if (process.env.KYC_SELFTEST) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const out = await win.webContents.executeJavaScript(`(async () => {
            const fm = await window.api.docx.fieldmap();
            const data = window.KYC.defaultData();
            Object.assign(data, {vp_typ:'np', vqf_mitglied_nr:'M-1234', gwg_file_nr:'2025-007', filler_name:'Test Erfasser', filler_datum:'2026-07-18', np_vorname:'Anna', np_name:'Beispiel', np_strasse:'Bahnhofstrasse 1', np_plz:'8610', np_ort:'Uster', np_staatsangehoerigkeit:'Deutschland', np_geburtsdatum:'1985-04-12', np_ausweiskopie_beigefuegt:true, lr_sitz:2, pep_ausl_ja:true, pep_ausl_nein:false});
            const ab = await window.KYC.buildZip(data, fm);
            const file = new File([ab], 'GwG_Test.zip', {type:'application/zip'});
            const res = await window.KYCImport.importFileList([file], fm);
            const d = res.persons[0] ? res.persons[0].data : null;
            return JSON.stringify({ parsed: res.parsed, skipped: res.skipped, recovered: d && {vp_typ:d.vp_typ, np_vorname:d.np_vorname, np_name:d.np_name, np_strasse:d.np_strasse, np_plz:d.np_plz, np_ort:d.np_ort, np_staat:d.np_staatsangehoerigkeit, np_geb:d.np_geburtsdatum, ausweis:d.np_ausweiskopie_beigefuegt, lr_sitz:d.lr_sitz, pep_ausl_ja:d.pep_ausl_ja, vqf:d.vqf_mitglied_nr, gwg:d.gwg_file_nr, filler_datum:d.filler_datum} });
          })()`);
          console.log('SELFTEST_RESULT=' + out);
        } catch (e) { console.log('SELFTEST_ERROR=' + e.message); }
        app.quit();
      }, 2500);
    });
  }
  // Dev-Hilfe: eigenes Fenster als PNG speichern (nur wenn KYC_SHOT gesetzt).
  if (process.env.KYC_SHOT) {
    const outDir = process.env.KYC_SHOT;
    const shot = async (name) => {
      try { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG()); }
      catch (e) { console.error('capture failed', name, e); }
    };
    const setView = async (v) => {
      try {
        await win.webContents.executeJavaScript(
          `(function(){var el=document.querySelector('[x-data]');var d=(window.Alpine&&Alpine.$data)?Alpine.$data(el):el._x_dataStack[0];d.view=${JSON.stringify(v)};return d.view;})()`
        );
      } catch (e) { console.error('view switch failed', v, e); }
      await new Promise(r => setTimeout(r, 800));
    };
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        await shot('dashboard');
        await setView('persons'); await shot('persons');
        await setView('screening'); await shot('screening');
        await setView('settings'); await shot('settings');
        await setView('form'); await shot('form');
        app.quit();
      }, 2600);
    });
  }
  // Externe Links im Standardbrowser öffnen (dilisense/SECO Verifikation)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

// ─── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  // Personen
  ipcMain.handle('persons:list', () => store.listPersons());
  ipcMain.handle('persons:get', (_e, id) => store.getPerson(id));
  ipcMain.handle('persons:save', (_e, person) => store.upsertPerson(person));
  ipcMain.handle('persons:delete', (_e, id) => store.deletePerson(id));
  ipcMain.handle('persons:due', () => store.duePersons());

  // Einstellungen
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));

  // SECO
  ipcMain.handle('seco:meta', () => Object.assign({ ready: seco.isReady() }, seco.meta(), store.getSeco()));
  ipcMain.handle('seco:refresh', async () => {
    const s = store.getSettings();
    const meta = await seco.refresh(s.secoUrl);
    store.setSeco(meta);
    return Object.assign({ ready: true }, meta);
  });

  // dilisense
  ipcMain.handle('dilisense:test', async (_e, key) => {
    const r = await dilisense.testKey(key || store.getSettings().dilisenseApiKey);
    store.bumpDilisenseUsage(1);   // Testabfrage zählt aufs Gratis-Kontingent
    return r;
  });
  ipcMain.handle('dilisense:usage', () => store.getDilisenseUsage());

  // Screening
  ipcMain.handle('screening:person', async (_e, id) => {
    const p = store.getPerson(id);
    if (!p) throw new Error('Person nicht gefunden.');
    const result = await screening.screenPerson(p, store.getSettings());
    store.recordScreening(id, result);
    if (result.diliUsed) store.bumpDilisenseUsage(1);
    return result;
  });
  ipcMain.handle('screening:due', async (_e) => {
    const s = store.getSettings();
    const res = await screening.screenDue(store, s, s.screeningIntervalDays, (done, total) => {
      if (win) win.webContents.send('screening:progress', { done, total });
    });
    return res;
  });
  // Treffer als geprüft/ok abhaken (False-Positive-Whitelist)
  ipcMain.handle('screening:clearHits', (_e, id, hitKeys) => store.clearPersonHits(id, hitKeys));
  // Screening-Nachweis als PDF (VQF-Revision)
  ipcMain.handle('screening:proofPdf', async (_e, id) => {
    const p = store.getPerson(id);
    if (!p) throw new Error('Person nicht gefunden.');
    const html = renderScreeningProof(p);
    const pdf = await htmlToPdf(html, { landscape: false });
    const name = 'Screening-Nachweis_' + (p.identity.displayName || 'Person').replace(/[^a-zA-Z0-9äöüÄÖÜ\- ]/g, '').trim().replace(/ /g, '_') + '.pdf';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Screening-Nachweis speichern', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdf);
    return { saved: true, path: filePath };
  });

  // Zeitplan (OS-Task)
  ipcMain.handle('scheduler:status', () => scheduler.status());
  ipcMain.handle('scheduler:install', (_e, opts) => scheduler.install(app, opts || {}));
  ipcMain.handle('scheduler:remove', () => scheduler.remove());

  // DOCX-Vorlagen für den Renderer — nur Whitelist (kein Path-Traversal)
  const ALLOWED_TEMPLATES = ['902.1.docx', '902.4.docx', '902.5.docx', '902.9.docx'];
  ipcMain.handle('docx:template', (_e, name) => {
    if (!ALLOWED_TEMPLATES.includes(name)) throw new Error('Unbekannte Vorlage: ' + name);
    const file = resourcePath(path.join('templates', name));
    const buf = fs.readFileSync(file);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.handle('docx:fieldmap', () => {
    return JSON.parse(fs.readFileSync(resourcePath('field-map.json'), 'utf-8'));
  });
  ipcMain.handle('docx:save', async (_e, defaultName, arrayBuffer) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'ZIP speichern',
      defaultPath: defaultName,
      filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return { saved: true, path: filePath };
  });

  // AML-/Kassageschäft-Auswertung
  ipcMain.handle('aml:analyze', (_e, payload) => {
    const p = payload || {};
    let text;
    if (p.text != null) {
      text = p.text;
    } else {
      if (!p.path || !/\.csv$/i.test(p.path)) throw new Error('Nur .csv-Dateien erlaubt.');
      text = fs.readFileSync(p.path, 'utf-8');
    }
    const records = aml.parseCsv(text);
    const agg = aml.analyze(records);
    if (!agg) throw new Error('CSV nicht erkannt — bitte Transaktions-Export (Lamassu-Format) verwenden.');
    const html = aml.renderReport(agg, { pruefer: p.pruefer });
    return { agg, html, records: records.length, sourceFile: p.name || (p.path ? path.basename(p.path) : '') };
  });
  // PDF-Export: Renderer übergibt nur agg+meta, HTML entsteht im Main-Prozess (kein Fremd-HTML)
  ipcMain.handle('aml:exportPdf', async (_e, agg, meta, defaultName) => {
    const pdf = await htmlToPdf(aml.renderReport(agg, meta || {}));
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'AML-Bericht als PDF speichern',
      defaultPath: defaultName || 'AML_Revision_Bericht.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdf);
    return { saved: true, path: filePath };
  });
  ipcMain.handle('aml:render', (_e, agg, meta) => aml.renderReport(agg, meta || {}));
  ipcMain.handle('aml:list', () => store.listAmlReports());
  ipcMain.handle('aml:save', (_e, report) => store.saveAmlReport(report));
  ipcMain.handle('aml:delete', (_e, id) => store.deleteAmlReport(id));

  // Archiv (aufbewahrte, "gelöschte" Personen)
  ipcMain.handle('persons:archived', () => store.listArchived());

  // HTML-Partial laden (Aufteilung des Renderer-Monolithen) — Whitelist
  const ALLOWED_PARTIALS = ['form-sections.html'];
  ipcMain.handle('app:partial', (_e, name) => {
    if (!ALLOWED_PARTIALS.includes(name)) throw new Error('Unbekanntes Partial: ' + name);
    return fs.readFileSync(path.join(__dirname, 'renderer', name), 'utf-8');
  });

  // CSV-Export der Personenliste (DSG: Nutzer bestätigt im UI vor Aufruf)
  ipcMain.handle('persons:exportCsv', async () => {
    const persons = store.listPersons();
    const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Name/Firma', 'Typ', 'Geburtsdatum', 'Nationalität', 'Ort', 'GwG-File-Nr', 'VQF-Nr', 'Ausland', 'Letzte Prüfung', 'Screening-Status', 'Erfasst', 'Aktualisiert']];
    for (const p of persons) {
      const id = p.identity || {}, k = p.kyc || {};
      rows.push([id.displayName, id.kind === 'entity' ? 'Firma' : 'Person', id.dob, id.nationality, id.country,
        k.gwg_file_nr, k.vqf_mitglied_nr, p.foreign ? 'ja' : 'nein', p.lastScreenedAt || '', p.screeningStatus, p.createdAt, p.updatedAt]);
    }
    const csv = '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Personenliste als CSV exportieren',
      defaultPath: 'KYC_Personenliste_' + new Date().toISOString().slice(0, 10) + '.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, csv, 'utf-8');
    return { saved: true, path: filePath, count: persons.length };
  });

  // KYC-Dossier als PDF (zusätzlich zum DOCX-ZIP)
  ipcMain.handle('persons:dossierPdf', async (_e, id) => {
    const p = store.getPerson(id);
    if (!p) throw new Error('Person nicht gefunden.');
    const pdf = await htmlToPdf(renderKycDossier(p), { landscape: false });
    const name = 'KYC_Dossier_' + (p.identity.displayName || 'Person').replace(/[^a-zA-Z0-9äöüÄÖÜ\- ]/g, '').trim().replace(/ /g, '_') + '.pdf';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'KYC-Dossier als PDF speichern', defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdf);
    return { saved: true, path: filePath };
  });

  // AML↔KYC-Verknüpfung: GwG-pflichtige ATM-Kunden einem KYC-Dossier zuordnen
  ipcMain.handle('aml:links', () => store.getAmlLinks());
  ipcMain.handle('aml:link', (_e, customerRef, personId) => store.setAmlLink(customerRef, personId));

  // App-Infos
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    dataDir: store.dataDir(),
    dbFile: store.dbFilePath(),
    encrypted: store.encryptionAvailable(),
    dilisenseUsage: store.getDilisenseUsage(),
    archivedCount: store.listArchived().length,
    isPackaged: app.isPackaged
  }));
  ipcMain.handle('app:openDataDir', () => shell.openPath(store.dataDir()));
  ipcMain.handle('app:openExternal', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
}

// ─── Start ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--amltest')) {
  // Dev: AML-CSV → PDF headless (testet printToPDF-Pipeline)
  app.whenReady().then(async () => {
    try {
      const text = fs.readFileSync(process.env.AML_CSV, 'utf-8');
      const agg = aml.analyze(aml.parseCsv(text));
      const html = aml.renderReport(agg, { pruefer: 'AML Revisions AG' });
      const pdf = await htmlToPdf(html);
      fs.writeFileSync(process.env.AML_OUT, pdf);
      console.log('AMLTEST_OK bytes=' + pdf.length + ' completed=' + agg.kpis.completed + ' vol=' + agg.kpis.totalVolume);
    } catch (e) { console.log('AMLTEST_ERR=' + e.message); }
    app.quit();
  });
} else if (HEADLESS) {
  app.whenReady().then(runHeadlessScreening).catch(err => {
    console.error(err);
    app.quit();
  });
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
    app.whenReady().then(() => {
      initData();
      registerIpc();
      createWindow();
      // Auto-Update (GitHub Releases). Fehler still ignorieren — z. B. wenn
      // (noch) kein Release veröffentlicht ist oder offline.
      if (app.isPackaged) {
        try {
          const { autoUpdater } = require('electron-updater');
          autoUpdater.autoDownload = true;
          autoUpdater.on('update-downloaded', (info) => {
            if (Notification.isSupported()) {
              new Notification({ title: 'KYC-Dashboard', body: 'Update ' + info.version + ' bereit — wird beim nächsten Schliessen installiert.' }).show();
            }
          });
          autoUpdater.checkForUpdatesAndNotify().catch(() => {});
        } catch (_) { /* updater optional */ }
      }
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }
}
