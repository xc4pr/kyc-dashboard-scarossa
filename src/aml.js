'use strict';

// ─── AML-/VQF-Auswertung Bitcoin-ATM (Kassageschäfte) ─────────────────────────
// Liest den Transaktions-CSV-Export im **Lamassu-Schema** (Spalten txClass, fiat,
// status='Sent'/'Success', customerId), berechnet die jährlichen Revisions-
// kennzahlen und erzeugt den Revisionsbericht (HTML → PDF). Andere Exporte
// (z. B. GeneralBytes mit Semikolon) werden erkannt und mit klarer Meldung
// abgewiesen (analyze → null).
// Methodik (validiert gegen Bestandsbericht 2026):
//   - Abgeschlossen = Status "Sent" (CashIn) oder "Success" (CashOut)
//   - Kunde = customerId; GwG-pflichtig, wenn mind. 1 Transaktion > CHF 1'000.00
//   - Betrag = Spalte fiat (CHF)

const GWG_THRESHOLD = 1000.00;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ── CSV ───────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.length > 1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

// ── Formatierung ──────────────────────────────────────────────────────────────
function chf(n) {
  const s = (Math.round(n * 100) / 100).toFixed(2);
  const [int, dec] = s.split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, "'") + '.' + dec;
}
function deDate(iso) {
  if (!iso) return '';
  const d = iso.slice(0, 10).split('-');
  if (d.length !== 3) return iso;
  return `${d[2]}.${d[1]}.${d[0]}`;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Analyse ───────────────────────────────────────────────────────────────────
// Rückgabe null, wenn die CSV nicht dem erwarteten Lamassu-Schema entspricht
// (z. B. GeneralBytes mit Semikolon/anderen Spalten) → klare Fehlermeldung im UI.
function analyze(records) {
  if (!records.length) return null;
  const cols = records[0];
  if (!('fiat' in cols) || !('txClass' in cols) || !('status' in cols)) return null;

  const fiat = r => parseFloat(r.fiat || '0') || 0;
  const isDone = r => r.status === 'Sent' || r.status === 'Success';

  const done = records.filter(isDone);
  const cancelled = records.length - done.length;

  // Zeitraum
  let minT = null, maxT = null;
  for (const r of done) {
    const t = r.created;
    if (!t) continue;
    if (!minT || t < minT) minT = t;
    if (!maxT || t > maxT) maxT = t;
  }

  // Kunden + GwG-Kategorisierung
  const byCust = {};
  for (const r of done) {
    const c = r.customerId || ('anon-' + (r.id || Math.random()));
    (byCust[c] = byCust[c] || []).push(fiat(r));
  }
  const uniqueCustomers = Object.keys(byCust).length;
  let gwgPflichtig = 0, gwgFrei = 0;
  const gwgList = [];   // anonymisierte Liste der identifikationspflichtigen Kunden
  for (const [cid, arr] of Object.entries(byCust)) {
    const max = Math.max.apply(null, arr);
    if (max > GWG_THRESHOLD) {
      gwgPflichtig++;
      gwgList.push({ ref: cid.slice(0, 8), txCount: arr.length, maxTx: max, volume: arr.reduce((a, b) => a + b, 0) });
    } else gwgFrei++;
  }
  gwgList.sort((a, b) => b.volume - a.volume);
  const exactThreshold = done.filter(r => fiat(r) === GWG_THRESHOLD).length;

  // CashIn / CashOut
  const cashIn = done.filter(r => r.txClass === 'cashIn');
  const cashOut = done.filter(r => r.txClass === 'cashOut');
  const sum = arr => arr.reduce((a, r) => a + fiat(r), 0);

  // Betragskategorien
  const bucketDefs = [
    ['CHF 0.01 – 99.99', 0.01, 99.99],
    ['CHF 100 – 249.99', 100, 249.99],
    ['CHF 250 – 499.99', 250, 499.99],
    ['CHF 500 – 749.99', 500, 749.99],
    ['CHF 750 – 999.99', 750, 999.99],
    ["CHF 1'000 – 1'999.99", 1000, 1999.99],
    ["CHF 2'000 – 4'999.99", 2000, 4999.99],
    ["CHF 5'000+", 5000, Infinity]
  ];
  const buckets = bucketDefs.map(([label, lo, hi]) => ({ label, lo, hi, count: 0, volume: 0 }));
  for (const r of done) {
    const v = fiat(r);
    for (const b of buckets) { if (v >= b.lo && v <= b.hi) { b.count++; b.volume += v; break; } }
  }

  // Monatlich
  const monthsMap = {};
  for (const r of done) {
    const key = (r.created || '').slice(0, 7); // yyyy-mm
    if (!key) continue;
    const m = monthsMap[key] || (monthsMap[key] = { key, ciCount: 0, ciSum: 0, coCount: 0, coSum: 0 });
    if (r.txClass === 'cashIn') { m.ciCount++; m.ciSum += fiat(r); }
    else if (r.txClass === 'cashOut') { m.coCount++; m.coSum += fiat(r); }
  }
  const monthly = Object.values(monthsMap).sort((a, b) => a.key.localeCompare(b.key)).map(m => {
    const [y, mo] = m.key.split('-');
    return { label: `${MONTHS[parseInt(mo, 10) - 1]} ${y}`, ciCount: m.ciCount, ciSum: m.ciSum, coCount: m.coCount, coSum: m.coSum, total: m.ciSum + m.coSum };
  });

  // Maschinen
  const machMap = {};
  for (const r of done) {
    const name = r.machineName || r.deviceId || '(unbekannt)';
    const m = machMap[name] || (machMap[name] = { name, ciCount: 0, ciSum: 0, coCount: 0, coSum: 0 });
    if (r.txClass === 'cashIn') { m.ciCount++; m.ciSum += fiat(r); }
    else if (r.txClass === 'cashOut') { m.coCount++; m.coSum += fiat(r); }
  }
  const machines = Object.values(machMap).sort((a, b) => (b.ciSum + b.coSum) - (a.ciSum + a.coSum))
    .map(m => ({ ...m, total: m.ciSum + m.coSum }));

  const totalVolume = sum(done);

  return {
    generatedAt: new Date().toISOString(),
    periodFrom: minT ? minT.slice(0, 10) : null,
    periodTo: maxT ? maxT.slice(0, 10) : null,
    threshold: GWG_THRESHOLD,
    kpis: { completed: done.length, cancelled, uniqueCustomers, totalVolume },
    gwg: { pflichtig: gwgPflichtig, frei: gwgFrei, exactThreshold },
    gwgList,
    cashIn: { count: cashIn.length, sum: sum(cashIn) },
    cashOut: { count: cashOut.length, sum: sum(cashOut) },
    buckets: buckets.map(b => ({ label: b.label, count: b.count, volume: b.volume })),
    monthly,
    machines
  };
}

// ── Bericht (HTML, A4 quer) ───────────────────────────────────────────────────
function renderReport(a, meta) {
  meta = meta || {};
  const pruefer = esc(meta.pruefer || '—');
  const erstellt = deDate(new Date().toISOString());
  const zeitraum = `${deDate(a.periodFrom)} – ${deDate(a.periodTo)}`;
  const geraete = a.machines.map(m => esc(m.name)).join(' &nbsp;|&nbsp; ') || '—';

  const kpiBox = (val, label, color) =>
    `<td width="25%" style="padding:12px 14px;border:1px solid #b8cce0;background:#f4f8fd;vertical-align:top;">
      <div style="font-size:24pt;font-weight:bold;color:${color};line-height:1.1;">${val}</div>
      <div style="font-size:8pt;color:#555;margin-top:3px;">${label}</div></td>`;

  const bucketRows = a.buckets.map((b, i) =>
    `<tr bgcolor="${i % 2 ? '#ffffff' : '#f4f7fb'}"><td style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${b.label}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${b.count}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(b.volume)}</td></tr>`).join('\n');

  const monthRows = a.monthly.map((m, i) =>
    `<tr bgcolor="${i % 2 ? '#ffffff' : '#f4f7fb'}"><td style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${m.label}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${m.ciCount}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(m.ciSum)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${m.coCount}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(m.coSum)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;font-weight:bold;">${chf(m.total)}</td></tr>`).join('\n');

  const machineRows = a.machines.map((m, i) =>
    `<tr bgcolor="${i % 2 ? '#ffffff' : '#f4f7fb'}"><td style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${esc(m.name)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${m.ciCount}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(m.ciSum)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${m.coCount}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(m.coSum)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;font-weight:bold;">${chf(m.total)}</td></tr>`).join('\n');

  const totalMonth = a.monthly.reduce((t, m) => ({ ci: t.ci + m.ciCount, cis: t.cis + m.ciSum, co: t.co + m.coCount, cos: t.cos + m.coSum, tot: t.tot + m.total }), { ci: 0, cis: 0, co: 0, cos: 0, tot: 0 });

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><style>
  @page { size: A4 landscape; margin: 1.6cm 2cm; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color:#1a1a1a; margin:0; padding:0; }
  h1 { font-size:15pt; color:#003366; border-bottom:2.5px solid #003366; padding-bottom:5px; margin:0 0 12px 0; }
  .section-title { font-size:11pt; font-weight:bold; color:#fff; background:#003366; padding:5px 10px; margin:20px 0 8px 0; display:block; }
  h3 { font-size:9.5pt; color:#003366; font-weight:bold; margin:14px 0 5px 0; }
  .footnote { font-size:7.5pt; color:#888; font-style:italic; margin-top:4px; }
  .footer { margin-top:24px; border-top:1px solid #ccc; padding-top:5px; font-size:7.5pt; color:#999; }
  .page-break { page-break-before:always; }
  table { border-collapse:collapse; }
  th { background:#003366; color:#fff; padding:7px 12px; text-align:right; font-size:9pt; white-space:nowrap; }
  th.l { text-align:left; }
  </style></head><body>

  <h1>AML-Revisionsunterlagen – Transaktionsanalyse</h1>
  <table width="100%" style="font-size:9.5pt;margin-bottom:16px;">
    <tr>
      <td style="padding:2px 0;width:130px;font-weight:bold;color:#555;">Erstellt am:</td><td style="padding:2px 20px 2px 0;">${erstellt}</td>
      <td style="padding:2px 0;width:100px;font-weight:bold;color:#555;">Prüfer:</td><td style="padding:2px 20px 2px 0;">${pruefer}</td>
      <td style="padding:2px 0;width:110px;font-weight:bold;color:#555;">Zeitraum:</td><td style="padding:2px 0;">${zeitraum}</td>
    </tr>
    <tr>
      <td style="padding:2px 0;font-weight:bold;color:#555;">Datengrundlage:</td><td style="padding:2px 20px 2px 0;">Transaktions-CSV (Lamassu ATM-System)</td>
      <td style="font-weight:bold;color:#555;">Geräte:</td><td colspan="3" style="padding:2px 0;">${geraete}</td>
    </tr>
  </table>

  <span class="section-title">1.6 / 2.1 &nbsp; Kundenliste – Transaktionsvolumina &amp; Mittelflüsse</span>
  <p style="font-size:9pt;color:#444;margin:0 0 10px 0;">Anonymisierte Kundenliste mit Mittelflüssen und GwG-Schwellenwert-Kategorisierung seit letzter Prüfung.</p>

  <table width="100%" cellspacing="6" style="margin-bottom:12px;"><tr>
    ${kpiBox(a.kpis.completed, 'Abgeschlossene Transaktionen', '#003366')}
    ${kpiBox(a.kpis.uniqueCustomers, 'Eindeutige Kunden', '#003366')}
    ${kpiBox(chf(a.kpis.totalVolume), 'Gesamtvolumen (CHF)', '#1a7a3c')}
    ${kpiBox(a.kpis.cancelled, 'Abgebrochen / Abgelaufen', '#b06000')}
  </tr></table>

  <h3>Kundenkategorisierung nach GwG-Schwellenwert (Grenze: CHF ${chf(a.threshold)})</h3>
  <table width="100%" cellspacing="8" style="margin-bottom:6px;"><tr>
    <td width="50%" style="padding:16px 20px;border:2.5px solid #c0392b;background:#fff6f5;vertical-align:top;">
      <div style="font-size:9.5pt;font-weight:bold;color:#333;margin-bottom:8px;">Kunden mit mind. 1 Transaktion &gt; CHF ${chf(a.threshold)} (ab CHF 1'000.01)</div>
      <div style="font-size:42pt;font-weight:bold;color:#c0392b;line-height:1.0;">${a.gwg.pflichtig}</div>
      <div style="font-size:8.5pt;color:#666;margin-top:6px;">GwG-pflichtig (Identifikationspflichtig)</div>
    </td>
    <td width="8">&nbsp;</td>
    <td width="50%" style="padding:16px 20px;border:2.5px solid #27ae60;background:#f4fff7;vertical-align:top;">
      <div style="font-size:9.5pt;font-weight:bold;color:#333;margin-bottom:8px;">Kunden mit ausschliesslich Transaktionen CHF 0.01 – ${chf(a.threshold)}</div>
      <div style="font-size:42pt;font-weight:bold;color:#27ae60;line-height:1.0;">${a.gwg.frei}</div>
      <div style="font-size:8.5pt;color:#666;margin-top:6px;">Nicht GwG-pflichtig (inkl. ${a.gwg.exactThreshold} Tx exakt CHF ${chf(a.threshold)})</div>
    </td>
  </tr></table>
  <p class="footnote">Basis: abgeschlossene Transaktionen (Status: Sent / Success). Ein Kunde erscheint nur in einer Kategorie.</p>

  ${(a.gwgList && a.gwgList.length) ? `
  <h3>Identifikationspflichtige Kunden (anonymisiert, Referenz = Kürzel der Kunden-ID)</h3>
  <table width="70%"><tr><th class="l">Kunden-Ref.</th><th>Anzahl Tx</th><th>Höchste Einzel-Tx (CHF)</th><th>Volumen (CHF)</th></tr>
  ${a.gwgList.map((c, i) => `<tr bgcolor="${i % 2 ? '#ffffff' : '#f4f7fb'}"><td style="padding:5px 12px;border-bottom:1px solid #dde5f0;font-family:monospace;">${esc(c.ref)}…</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${c.txCount}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(c.maxTx)}</td><td align="right" style="padding:5px 12px;border-bottom:1px solid #dde5f0;">${chf(c.volume)}</td></tr>`).join('')}
  </table>` : ''}

  <div class="page-break"></div>

  <span class="section-title">Transaktionsvolumen-Verteilung nach Betragskategorie</span>
  <table width="60%"><tr><th class="l">Betragskategorie</th><th>Anzahl Transaktionen</th><th>Volumen (CHF)</th></tr>
  ${bucketRows}
  </table>

  <span class="section-title" style="margin-top:22px;">2.1 &nbsp; Monatliche Übersicht – Zu- und Abgänge (CashIn / CashOut)</span>
  <table width="100%" cellspacing="6" style="margin-bottom:12px;"><tr>
    ${kpiBox(a.cashIn.count, 'Einzahlungen (CashIn)', '#003366')}
    ${kpiBox(chf(a.cashIn.sum), 'Gesamtbetrag Einzahlungen (CHF)', '#1a7a3c')}
    ${kpiBox(a.cashOut.count, 'Bezüge (CashOut)', '#003366')}
    ${kpiBox(chf(a.cashOut.sum), 'Gesamtbetrag Bezüge (CHF)', '#b06000')}
  </tr></table>
  <table width="100%"><tr><th class="l">Monat</th><th>Einzahlungen (Anz.)</th><th>Einzahlungen (CHF)</th><th>Bezüge (Anz.)</th><th>Bezüge (CHF)</th><th>Monatsvolumen (CHF)</th></tr>
  ${monthRows}
  <tr bgcolor="#ccd8ec"><td style="padding:6px 12px;font-weight:bold;">Total</td><td align="right" style="padding:6px 12px;font-weight:bold;">${totalMonth.ci}</td><td align="right" style="padding:6px 12px;font-weight:bold;">${chf(totalMonth.cis)}</td><td align="right" style="padding:6px 12px;font-weight:bold;">${totalMonth.co}</td><td align="right" style="padding:6px 12px;font-weight:bold;">${chf(totalMonth.cos)}</td><td align="right" style="padding:6px 12px;font-weight:bold;">${chf(totalMonth.tot)}</td></tr>
  </table>

  <span class="section-title" style="margin-top:22px;">2.3 &nbsp; Systeme zur Überwachung von Kassageschäften</span>
  <p style="font-size:9pt;color:#444;margin:0 0 8px 0;">Eingesetzte ATM-Geräte (Lamassu-Plattform) im Prüfungszeitraum:</p>
  <table width="100%"><tr><th class="l">Gerätename</th><th>Einzahlungen (Anz.)</th><th>Einzahlungen (CHF)</th><th>Bezüge (Anz.)</th><th>Bezüge (CHF)</th><th>Gesamtvolumen (CHF)</th></tr>
  ${machineRows}
  </table>

  <div class="footer">AML-Transaktionsanalyse – Vertraulich / Nur für interne Revisionszwecke &nbsp;|&nbsp; Erstellt: ${erstellt} &nbsp;|&nbsp; Zeitraum: ${zeitraum}</div>
  </body></html>`;
}

module.exports = { parseCsv, analyze, renderReport, chf, GWG_THRESHOLD };
