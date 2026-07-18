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

// HTML → PDF (A4 quer) über ein unsichtbares Fenster
async function htmlToPdf(html) {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await w.webContents.printToPDF({ landscape: true, printBackground: true, pageSize: 'A4' });
  } finally {
    w.destroy();
  }
}

// ─── Headless-Screening (vom OS-Zeitplan gestartet) ───────────────────────────
async function runHeadlessScreening() {
  initData();
  const settings = store.getSettings();
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
    backgroundColor: '#0d1117',
    title: 'KYC-Dashboard Scarossa',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
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
    return dilisense.testKey(key || store.getSettings().dilisenseApiKey);
  });

  // Screening
  ipcMain.handle('screening:person', async (_e, id) => {
    const p = store.getPerson(id);
    if (!p) throw new Error('Person nicht gefunden.');
    const result = await screening.screenPerson(p, store.getSettings());
    store.recordScreening(id, result);
    return result;
  });
  ipcMain.handle('screening:due', async (_e) => {
    const s = store.getSettings();
    const res = await screening.screenDue(store, s, s.screeningIntervalDays, (done, total) => {
      if (win) win.webContents.send('screening:progress', { done, total });
    });
    return res;
  });

  // Zeitplan (OS-Task)
  ipcMain.handle('scheduler:status', () => scheduler.status());
  ipcMain.handle('scheduler:install', (_e, opts) => scheduler.install(app, opts || {}));
  ipcMain.handle('scheduler:remove', () => scheduler.remove());

  // DOCX-Vorlagen für den Renderer
  ipcMain.handle('docx:template', (_e, name) => {
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
    const text = p.text != null ? p.text : fs.readFileSync(p.path, 'utf-8');
    const records = aml.parseCsv(text);
    const agg = aml.analyze(records);
    const html = aml.renderReport(agg, { pruefer: p.pruefer });
    return { agg, html, records: records.length, sourceFile: p.name || (p.path ? path.basename(p.path) : '') };
  });
  ipcMain.handle('aml:render', (_e, agg, meta) => aml.renderReport(agg, meta || {}));
  ipcMain.handle('aml:exportPdf', async (_e, html, defaultName) => {
    const pdf = await htmlToPdf(html);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'AML-Bericht als PDF speichern',
      defaultPath: defaultName || 'AML_Revision_Bericht.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, pdf);
    return { saved: true, path: filePath };
  });
  ipcMain.handle('aml:list', () => store.listAmlReports());
  ipcMain.handle('aml:save', (_e, report) => store.saveAmlReport(report));
  ipcMain.handle('aml:delete', (_e, id) => store.deleteAmlReport(id));

  // App-Infos
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    dataDir: store.dataDir(),
    dbFile: store.dbFilePath(),
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
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  }
}
