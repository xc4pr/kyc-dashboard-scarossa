'use strict';

// ─── OS-Zeitplan für automatisches wöchentliches Screening ────────────────────
// Registriert einen Betriebssystem-Task, der die App im Headless-Modus
// (--screen) startet, alle fälligen Personen prüft und bei Treffern eine
// System-Benachrichtigung zeigt. Läuft auch ohne geöffnete App.
//   Windows: schtasks (Aufgabenplanung)
//   Linux:   systemd --user timer

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TASK_NAME = 'KYC-Screening-Scarossa';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

// Startkommando für den Screening-Lauf. In der installierten App ist das die
// EXE selbst mit --screen; im Dev-Modus electron + Projektpfad.
function screenCommand(app) {
  const exe = process.execPath;                 // in Prod: die App-EXE
  const args = [];
  if (!app.isPackaged) args.push(app.getAppPath());
  args.push('--screen');
  return { exe, args };
}

// ── Windows ──────────────────────────────────────────────────────────────────
async function installWindows(app, day, time) {
  const { exe, args } = screenCommand(app);
  const tr = `"${exe}" ${args.join(' ')}`.trim();
  await run('schtasks', [
    '/Create', '/TN', TASK_NAME,
    '/TR', tr,
    '/SC', 'WEEKLY', '/D', day || 'MON',
    '/ST', time || '09:00',
    '/F'
  ]);
  return { platform: 'win32', task: TASK_NAME };
}
async function removeWindows() {
  await run('schtasks', ['/Delete', '/TN', TASK_NAME, '/F']);
  return { removed: true };
}
async function statusWindows() {
  try {
    const { stdout } = await run('schtasks', ['/Query', '/TN', TASK_NAME]);
    return { installed: true, detail: stdout.trim().split('\n').slice(0, 3).join(' ') };
  } catch (_) { return { installed: false }; }
}

// ── Linux (systemd --user) ────────────────────────────────────────────────────
function systemdDir() {
  const dir = path.join(os.homedir(), '.config', 'systemd', 'user');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
async function installLinux(app, day, time) {
  const { exe, args } = screenCommand(app);
  const dir = systemdDir();
  const execLine = [exe, ...args].map(a => a.includes(' ') ? `'${a}'` : a).join(' ');
  const onCal = `${(day || 'Mon')} ${(time || '09:00')}:00`;   // z. B. "Mon 09:00:00"

  fs.writeFileSync(path.join(dir, 'kyc-screening.service'),
`[Unit]
Description=KYC-Screening Scarossa (SECO + dilisense)

[Service]
Type=oneshot
ExecStart=${execLine}
`);
  fs.writeFileSync(path.join(dir, 'kyc-screening.timer'),
`[Unit]
Description=Wöchentliches KYC-Screening

[Timer]
OnCalendar=${onCal}
Persistent=true

[Install]
WantedBy=timers.target
`);
  await run('systemctl', ['--user', 'daemon-reload']);
  await run('systemctl', ['--user', 'enable', '--now', 'kyc-screening.timer']);
  return { platform: 'linux', timer: 'kyc-screening.timer' };
}
async function removeLinux() {
  try { await run('systemctl', ['--user', 'disable', '--now', 'kyc-screening.timer']); } catch (_) {}
  const dir = systemdDir();
  for (const f of ['kyc-screening.timer', 'kyc-screening.service']) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
  }
  try { await run('systemctl', ['--user', 'daemon-reload']); } catch (_) {}
  return { removed: true };
}
async function statusLinux() {
  try {
    const { stdout } = await run('systemctl', ['--user', 'is-enabled', 'kyc-screening.timer']);
    return { installed: stdout.trim() === 'enabled', detail: stdout.trim() };
  } catch (_) { return { installed: false }; }
}

// ── Öffentliche API ───────────────────────────────────────────────────────────
async function install(app, opts) {
  const day = opts && opts.day, time = opts && opts.time;
  if (process.platform === 'win32') return installWindows(app, day, time);
  if (process.platform === 'linux') return installLinux(app, day, time);
  throw new Error('Automatischer Zeitplan wird auf dieser Plattform nicht unterstützt.');
}
async function remove() {
  if (process.platform === 'win32') return removeWindows();
  if (process.platform === 'linux') return removeLinux();
  return { removed: false };
}
async function status() {
  if (process.platform === 'win32') return statusWindows();
  if (process.platform === 'linux') return statusLinux();
  return { installed: false, unsupported: true };
}

module.exports = { install, remove, status, TASK_NAME };
