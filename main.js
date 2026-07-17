'use strict';

const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const store = require('./src/store');
const seco = require('./src/seco');
const dilisense = require('./src/dilisense');
const screening = require('./src/screening');
const scheduler = require('./src/scheduler');

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
if (HEADLESS) {
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
