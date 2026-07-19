'use strict';

// ─── Import: ausgefüllte VQF-Formulare (DOCX/ZIP) → Datensatz ──────────────────
// Kehrt die Befüllung um: liest die Legacy-Formularfelder (ffData) an ihrer
// Ordinalposition aus, mappt sie via field-map zurück auf data_keys und
// rekonstruiert daraus den KYC-Datensatz. Unterstützt die vier Vorlagen
// (902.1/4/5/9) einzeln und die Export-ZIPs dieses Systems.

const IMP_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function impParentParagraph(ff) {
  let el = ff.parentElement;
  while (el) { if (el.localName === 'p' && el.namespaceURI === IMP_W_NS) return el; el = el.parentElement; }
  return null;
}
function impParentRun(ff) {
  let el = ff.parentElement;
  while (el) { if (el.localName === 'r' && el.namespaceURI === IMP_W_NS) return el; el = el.parentElement; }
  return null;
}

// Text zwischen 'separate' und 'end' auslesen (Umkehr von setTextField)
function readTextField(ff) {
  const p = impParentParagraph(ff);
  if (!p) return '';
  const runs = Array.from(p.children).filter(c => c.localName === 'r' && c.namespaceURI === IMP_W_NS);
  const beginIdx = runs.indexOf(impParentRun(ff));
  if (beginIdx === -1) return '';
  let sepIdx = -1;
  for (let i = beginIdx + 1; i < runs.length; i++) {
    const fc = runs[i].getElementsByTagNameNS(IMP_W_NS, 'fldChar')[0];
    if (fc && fc.getAttributeNS(IMP_W_NS, 'fldCharType') === 'separate') { sepIdx = i; break; }
  }
  if (sepIdx === -1) return '';
  let text = '';
  for (let j = sepIdx + 1; j < runs.length; j++) {
    const fc = runs[j].getElementsByTagNameNS(IMP_W_NS, 'fldChar')[0];
    if (fc && fc.getAttributeNS(IMP_W_NS, 'fldCharType') === 'end') break;
    const ts = runs[j].getElementsByTagNameNS(IMP_W_NS, 't');
    for (const t of Array.from(ts)) text += t.textContent;
  }
  return text.trim();
}

function readCheckbox(ff) {
  const cb = ff.getElementsByTagNameNS(IMP_W_NS, 'checkBox')[0];
  if (!cb) return false;
  const checked = cb.getElementsByTagNameNS(IMP_W_NS, 'checked')[0];
  if (checked && checked.getAttributeNS(IMP_W_NS, 'val') === '1') return true;
  const def = cb.getElementsByTagNameNS(IMP_W_NS, 'default')[0];
  return !!(def && def.getAttributeNS(IMP_W_NS, 'val') === '1');
}

// Ein DOCX auslesen → { tpl, raw:{data_key: value} }  oder null (nicht erkannt)
async function parseTemplateDocx(arrayBuffer, fieldMap) {
  let zip;
  try { zip = await JSZip.loadAsync(arrayBuffer); } catch { return null; }
  const docFile = zip.file('word/document.xml');
  if (!docFile) return null;
  const xml = await docFile.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const ffList = Array.from(doc.getElementsByTagNameNS(IMP_W_NS, 'ffData'));

  // Vorlage über Feldanzahl erkennen (902.1=78, 902.4=69, 902.5=21, 902.9=11)
  let tpl = null;
  for (const key of Object.keys(fieldMap)) {
    if (fieldMap[key].length === ffList.length) { tpl = key; break; }
  }
  if (!tpl) return null;

  const raw = {};
  for (const field of fieldMap[tpl]) {
    const { idx, data_key, type } = field;
    if (!data_key) continue;
    const ff = ffList[idx];
    if (!ff) continue;
    if (type === 'text') {
      const v = readTextField(ff);
      if (v) raw[data_key] = v;
    } else if (type === 'checkbox') {
      if (readCheckbox(ff)) raw[data_key] = true;
    }
  }
  return { tpl, raw };
}

function mergeRaw(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (target[k] === undefined || target[k] === '' || target[k] === false) target[k] = v;
  }
}

// ─── Umkehr: raw (DOCX-Keys) → UI-Datensatz ───────────────────────────────────

function deDate(s) { // dd.mm.yyyy → yyyy-mm-dd
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec((s || '').trim());
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
function splitName(combined) { // "Name, Vorname" → {name, vorname}
  if (!combined) return { name: '', vorname: '' };
  const i = combined.indexOf(',');
  if (i === -1) return { name: combined.trim(), vorname: '' };
  return { name: combined.slice(0, i).trim(), vorname: combined.slice(i + 1).trim() };
}
function splitAddr(combined) { // "Strasse, PLZ Ort" → {strasse, plz, ort}
  if (!combined) return { strasse: '', plz: '', ort: '' };
  const i = combined.lastIndexOf(',');
  const strasse = i === -1 ? '' : combined.slice(0, i).trim();
  const rest = (i === -1 ? combined : combined.slice(i + 1)).trim();
  const m = /^(\d{4,6})\s+(.*)$/.exec(rest);
  if (m) return { strasse: strasse || '', plz: m[1], ort: m[2] };
  return { strasse: strasse, plz: '', ort: rest };
}

function rawToData(raw) {
  const d = window.KYC.defaultData();

  // 1) Direkte Felder (Schlüssel existiert bereits im Datenmodell)
  for (const k of Object.keys(d)) {
    if (raw[k] !== undefined && typeof d[k] !== 'object') {
      d[k] = raw[k];
    }
  }

  // 2) Kombinierte Namen zurück in Split-Felder
  const npn = splitName(raw.np_name_vorname); if (npn.name || npn.vorname) { d.np_name = npn.name; d.np_vorname = npn.vorname; }
  const jpk = splitName(raw.jp_kontaktperson); if (jpk.name || jpk.vorname) { d.jp_kp_name = jpk.name; d.jp_kp_vorname = jpk.vorname; }
  const e0 = splitName(raw.eroeffner_0_name); if (e0.name || e0.vorname) { d.eroeffner_0_nachname = e0.name; d.eroeffner_0_vorname = e0.vorname; }
  const e1 = splitName(raw.eroeffner_1_name); if (e1.name || e1.vorname) { d.eroeffner_1_nachname = e1.name; d.eroeffner_1_vorname = e1.vorname; }

  // 3) Kombinierte Adressen zurück in Split-Felder
  const na = splitAddr(raw.np_wohnsitzadresse); if (na.strasse || na.plz || na.ort) { d.np_strasse = na.strasse; d.np_plz = na.plz; d.np_ort = na.ort; }
  const ea = splitAddr(raw.eu_geschaeftsadresse); if (ea.strasse || ea.plz || ea.ort) { d.eu_strasse = ea.strasse; d.eu_plz = ea.plz; d.eu_ort = ea.ort; }
  const ja = splitAddr(raw.jp_domiziladresse); if (ja.strasse || ja.plz || ja.ort) { d.jp_strasse = ja.strasse; d.jp_plz = ja.plz; d.jp_ort = ja.ort; }
  const e0a = splitAddr(raw.eroeffner_0_wohnsitz); if (e0a.strasse || e0a.plz || e0a.ort) { d.eroeffner_0_strasse = e0a.strasse; d.eroeffner_0_plz = e0a.plz; d.eroeffner_0_ort = e0a.ort; }
  const e1a = splitAddr(raw.eroeffner_1_wohnsitz); if (e1a.strasse || e1a.plz || e1a.ort) { d.eroeffner_1_strasse = e1a.strasse; d.eroeffner_1_plz = e1a.plz; d.eroeffner_1_ort = e1a.ort; }
  const wa = splitAddr(raw.wb_wohnsitzadresse); if (wa.strasse || wa.plz || wa.ort) { d.wb_strasse = wa.strasse; d.wb_plz = wa.plz; d.wb_ort = wa.ort; }

  // 4) Daten (dd.mm.yyyy → ISO)
  for (const k of ['filler_datum', 'vertragsschluss_datum', 'np_geburtsdatum', 'eroeffner_0_geburtsdatum',
    'eroeffner_1_geburtsdatum', 'wb_geburtsdatum', 'pep_zustimmung_datum', 'high_risk_zustimmung_datum',
    'vorgesetzte_zustimmung_datum']) {
    if (raw[k]) { const iso = deDate(raw[k]); if (iso) d[k] = iso; }
  }

  // 5) Radiogruppen aus Bool-Keys zusammenführen
  for (const g of ['lr_sitz', 'lr_geschaeft', 'lr_zahlung', 'branchenrisiko', 'kontaktrisiko', 'produktrisiko']) {
    for (let i = 0; i <= 2; i++) if (raw[`${g}_${i}`]) d[g] = i;
  }
  for (const n of [1, 2]) {
    for (let i = 0; i <= 2; i++) if (raw[`ek${n}_risiko_${i}`]) d[`ek${n}_risiko`] = i;
  }

  // 6) Vertragspartei-Typ ableiten
  if (raw.jp_firma || raw.jp_domiziladresse) d.vp_typ = 'jp';
  else if (raw.eu_firma || raw.eu_geschaeftsadresse) d.vp_typ = 'eu';
  else d.vp_typ = 'np';

  return d;
}

// ─── Öffentliche API ──────────────────────────────────────────────────────────
// files: FileList/Array<File>. Rückgabe: {persons:[{data, src}], skipped:[names], parsed:n}
async function importFileList(files, fieldMap) {
  const loose = [];
  const persons = [];
  const skipped = [];

  for (const f of Array.from(files)) {
    const name = (f.name || '').toLowerCase();
    let ab;
    try { ab = await f.arrayBuffer(); } catch { skipped.push(f.name); continue; }

    if (name.endsWith('.zip')) {
      let zip; try { zip = await JSZip.loadAsync(ab); } catch { skipped.push(f.name); continue; }
      const raws = {}; const tpls = new Set();
      for (const fn of Object.keys(zip.files)) {
        if (!fn.toLowerCase().endsWith('.docx')) continue;
        const dab = await zip.files[fn].async('arraybuffer');
        const r = await parseTemplateDocx(dab, fieldMap);
        if (r) { mergeRaw(raws, r.raw); tpls.add(r.tpl); }
      }
      if (tpls.size) persons.push({ raw: raws, src: f.name, tpls: Array.from(tpls) });
      else skipped.push(f.name);
    } else if (name.endsWith('.docx')) {
      const r = await parseTemplateDocx(ab, fieldMap);
      if (r) loose.push({ tpl: r.tpl, raw: r.raw, src: f.name }); else skipped.push(f.name);
    } else {
      skipped.push(f.name);
    }
  }

  // Lose DOCX gruppieren: unterschiedliche Vorlagen = eine Person, sonst je Datei eine
  if (loose.length) {
    const tpls = loose.map(x => x.tpl);
    const distinct = new Set(tpls).size === tpls.length;
    if (distinct && loose.length > 1) {
      const raws = {}; for (const x of loose) mergeRaw(raws, x.raw);
      persons.push({ raw: raws, src: loose.map(x => x.src).join(', '), tpls });
    } else {
      for (const x of loose) persons.push({ raw: x.raw, src: x.src, tpls: [x.tpl] });
    }
  }

  return {
    persons: persons.map(p => ({ data: rawToData(p.raw), src: p.src, tpls: p.tpls })),
    skipped,
    parsed: persons.length
  };
}

const ALL_TEMPLATES = ['902.1', '902.4', '902.5', '902.9'];

window.KYCImport = { importFileList, ALL_TEMPLATES };
