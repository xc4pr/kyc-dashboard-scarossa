'use strict';

// ─── KYC-Datenmodell + DOCX-Befüllung (Renderer) ──────────────────────────────
// Portiert aus der alten app.js. Änderungen ggü. v1:
//  - Vorlagen kommen via IPC (window.api.docx.template) statt fetch()
//  - Export speichert via nativen Datei-Dialog (window.api.docx.save)

const defaultData = () => ({
  vqf_mitglied_nr: '', gwg_file_nr: '', filler_name: '', filler_datum: '',
  vp_typ: 'np',
  np_vorname: '', np_name: '', np_strasse: '', np_plz: '', np_ort: '',
  np_telefon: '', np_email: '', np_geburtsdatum: '', np_staatsangehoerigkeit: '',
  np_identifikationsdokument: '', np_ausweiskopie_beigefuegt: false,
  eu_firma: '', eu_strasse: '', eu_plz: '', eu_ort: '',
  eu_identifikationsdokument: '', eu_kopie_beigefuegt: false,
  jp_firma: '', jp_strasse: '', jp_plz: '', jp_ort: '',
  jp_kp_vorname: '', jp_kp_name: '', jp_telefon: '', jp_email: '',
  jp_identifikationsdokument: '', jp_kopie_beigefuegt: false,
  eroeffner_0_vorname: '', eroeffner_0_nachname: '', eroeffner_0_strasse: '', eroeffner_0_plz: '',
  eroeffner_0_ort: '', eroeffner_0_geburtsdatum: '', eroeffner_0_staatsang: '', eroeffner_0_berechtigung: '',
  eroeffner_0_dok_kopie: false, eroeffner_0_leg_hr: false, eroeffner_0_leg_vollmacht: false,
  eroeffner_0_leg_anderes_cb: false, eroeffner_0_leg_anderes_tx: '',
  eroeffner_1_vorname: '', eroeffner_1_nachname: '', eroeffner_1_strasse: '', eroeffner_1_plz: '',
  eroeffner_1_ort: '', eroeffner_1_geburtsdatum: '', eroeffner_1_staatsang: '', eroeffner_1_berechtigung: '',
  eroeffner_1_dok_kopie: false, eroeffner_1_leg_hr: false, eroeffner_1_leg_vollmacht: false,
  eroeffner_1_leg_anderes_cb: false, eroeffner_1_leg_anderes_tx: '',
  vertragsschluss_datum: '', aufnahme_persoenlich: false, aufnahme_korrespondenz: false,
  aufnahme_echtheit: false, aufnahme_wohnsitz: false,
  korrespondenz_vertragspartei: false, korrespondenz_banklagernd: false, korrespondenz_mitglied: false,
  korrespondenz_dritte: false, korrespondenz_dritte_adresse: '',
  sprache_deutsch: true, sprache_englisch: false, sprache_franzoesisch: false,
  sprache_andere_cb: false, sprache_andere_tx: '', weiteres: '',
  wb_typ_np_selber: false, wb_typ_operative_jp: false, wb_typ_stiftung: false,
  wb_typ_trust: false, wb_typ_versicherung: false, wb_typ_902_9: false,
  embargo_pruefung_resultat: '',
  laufkunde_geldwechsel: false, laufkunde_wertuebertragung: false,
  laufkunde_anderes_cb: false, laufkunde_anderes_tx: '', laufkunde_zweck: '',
  dok_vp_cb: false, dok_vp_tx: '', dok_eroeffner_cb: false, dok_eroeffner_tx: '',
  dok_wb_cb: false, dok_kundenprofil_cb: false, dok_risikoprofil_cb: false,
  pep_ausl_nein: true, pep_ausl_ja: false, pep_inl_nein: true, pep_inl_ja: false,
  pep_int_nein: true, pep_int_ja: false, pep_zustimmung_datum: '',
  high_risk_nein: true, high_risk_ja: false, high_risk_zustimmung_datum: '',
  lr_sitz: 0, lr_geschaeft: 0, lr_zahlung: 0, branchenrisiko: 0, kontaktrisiko: 0, produktrisiko: 0,
  ek1_bezeichnung: '', ek1_risiko: null, ek2_bezeichnung: '', ek2_risiko: null,
  risiko_begruendung_abweichend: '', risiko_ohne_erhoehtes: true, risiko_mit_erhoehtem: false,
  vorgesetzte_zustimmung_datum: '', eigenes_transaktionskriterium: '',
  kp_beruf: '', kp_einkommen: '', kp_eingebrachte_art: '',
  kp_kategorie_ersparnis: false, kp_kategorie_geschaeft: false, kp_kategorie_erbschaft: false,
  kp_kategorie_anderes_cb: false, kp_kategorie_anderes_tx: '',
  kp_herkunft_detailliert: '', kp_zweck: '', kp_geplante_entwicklung: '', kp_geschaeftsvolumen: '',
  kp_beziehung_dritte: '', kp_gwg_files: '', kp_introducer: '', kp_sonstiges: '',
  wb_name: '', wb_vorname: '', wb_geburtsdatum: '', wb_nationalitaet: '',
  wb_strasse: '', wb_plz: '', wb_ort: ''
});

function formatDate(isoStr) {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-');
  if (!y || !m || !d) return isoStr;
  return `${d}.${m}.${y}`;
}
function joinName(vorname, name) {
  if (vorname && name) return `${name}, ${vorname}`;
  return name || vorname || '';
}
function joinAddr(strasse, plz, ort) {
  const plzOrt = [plz, ort].filter(Boolean).join(' ');
  if (strasse && plzOrt) return `${strasse}, ${plzOrt}`;
  return strasse || plzOrt || '';
}
function vpName(data) {
  if (data.vp_typ === 'np') return joinName(data.np_vorname, data.np_name);
  if (data.vp_typ === 'eu') return data.eu_firma;
  if (data.vp_typ === 'jp') return data.jp_firma;
  return '';
}

function expandRadio(data) {
  const expanded = Object.assign({}, data);
  expanded.np_name_vorname = joinName(data.np_vorname, data.np_name);
  expanded.np_wohnsitzadresse = joinAddr(data.np_strasse, data.np_plz, data.np_ort);
  expanded.eu_geschaeftsadresse = joinAddr(data.eu_strasse, data.eu_plz, data.eu_ort);
  expanded.jp_domiziladresse = joinAddr(data.jp_strasse, data.jp_plz, data.jp_ort);
  expanded.jp_kontaktperson = joinName(data.jp_kp_vorname, data.jp_kp_name);
  expanded.eroeffner_0_name = joinName(data.eroeffner_0_vorname, data.eroeffner_0_nachname);
  expanded.eroeffner_0_wohnsitz = joinAddr(data.eroeffner_0_strasse, data.eroeffner_0_plz, data.eroeffner_0_ort);
  expanded.eroeffner_1_name = joinName(data.eroeffner_1_vorname, data.eroeffner_1_nachname);
  expanded.eroeffner_1_wohnsitz = joinAddr(data.eroeffner_1_strasse, data.eroeffner_1_plz, data.eroeffner_1_ort);
  expanded.wb_wohnsitzadresse = joinAddr(data.wb_strasse, data.wb_plz, data.wb_ort);
  expanded.vp_name = vpName(data);
  expanded.filler_datum = formatDate(data.filler_datum);
  expanded.vertragsschluss_datum = formatDate(data.vertragsschluss_datum);
  expanded.np_geburtsdatum = formatDate(data.np_geburtsdatum);
  expanded.eroeffner_0_geburtsdatum = formatDate(data.eroeffner_0_geburtsdatum);
  expanded.eroeffner_1_geburtsdatum = formatDate(data.eroeffner_1_geburtsdatum);
  expanded.wb_geburtsdatum = formatDate(data.wb_geburtsdatum);
  expanded.pep_zustimmung_datum = formatDate(data.pep_zustimmung_datum);
  expanded.high_risk_zustimmung_datum = formatDate(data.high_risk_zustimmung_datum);
  expanded.vorgesetzte_zustimmung_datum = formatDate(data.vorgesetzte_zustimmung_datum);
  for (const [key, val] of [
    ['lr_sitz', ['lr_sitz_0', 'lr_sitz_1', 'lr_sitz_2']],
    ['lr_geschaeft', ['lr_geschaeft_0', 'lr_geschaeft_1', 'lr_geschaeft_2']],
    ['lr_zahlung', ['lr_zahlung_0', 'lr_zahlung_1', 'lr_zahlung_2']],
    ['branchenrisiko', ['branchenrisiko_0', 'branchenrisiko_1', 'branchenrisiko_2']],
    ['kontaktrisiko', ['kontaktrisiko_0', 'kontaktrisiko_1', 'kontaktrisiko_2']],
    ['produktrisiko', ['produktrisiko_0', 'produktrisiko_1', 'produktrisiko_2']]
  ]) {
    val.forEach((k, i) => { expanded[k] = (data[key] === i); });
  }
  [1, 2].forEach(n => {
    const r = data[`ek${n}_risiko`];
    expanded[`ek${n}_risiko_0`] = (r === 0);
    expanded[`ek${n}_risiko_1`] = (r === 1);
    expanded[`ek${n}_risiko_2`] = (r === 2);
  });
  return expanded;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function findParentParagraph(ffData) {
  let el = ffData.parentElement;
  while (el) { if (el.localName === 'p' && el.namespaceURI === W_NS) return el; el = el.parentElement; }
  return null;
}
function findParentRun(el) {
  let node = el.parentElement;
  while (node) { if (node.localName === 'r' && node.namespaceURI === W_NS) return node; node = node.parentElement; }
  return null;
}
function setTextField(ffData, value) {
  const p = findParentParagraph(ffData);
  if (!p) return;
  const runs = Array.from(p.children).filter(c => c.localName === 'r' && c.namespaceURI === W_NS);
  const beginRun = findParentRun(ffData);
  const beginIdx = runs.indexOf(beginRun);
  if (beginIdx === -1) return;
  for (let i = beginIdx + 1; i < runs.length; i++) {
    const fc = runs[i].getElementsByTagNameNS(W_NS, 'fldChar')[0];
    if (fc && fc.getAttributeNS(W_NS, 'fldCharType') === 'separate') {
      const nextRun = runs[i + 1];
      if (!nextRun) return;
      const nextFc = nextRun.getElementsByTagNameNS(W_NS, 'fldChar')[0];
      if (nextFc && nextFc.getAttributeNS(W_NS, 'fldCharType') === 'end') {
        const newRun = p.ownerDocument.createElementNS(W_NS, 'w:r');
        const tEl = p.ownerDocument.createElementNS(W_NS, 'w:t');
        tEl.textContent = value;
        if (value.includes(' ')) tEl.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        newRun.appendChild(tEl);
        nextRun.before(newRun);
      } else {
        let tEl = nextRun.getElementsByTagNameNS(W_NS, 't')[0];
        if (!tEl) { tEl = p.ownerDocument.createElementNS(W_NS, 'w:t'); nextRun.appendChild(tEl); }
        tEl.textContent = value;
        if (value.includes(' ')) tEl.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        else tEl.removeAttributeNS(XML_NS, 'xml:space');
      }
      return;
    }
  }
}
function setCheckbox(ffData, checked) {
  const cbEl = ffData.getElementsByTagNameNS(W_NS, 'checkBox')[0];
  if (!cbEl) return;
  const val = checked ? '1' : '0';
  let defaultEl = cbEl.getElementsByTagNameNS(W_NS, 'default')[0];
  if (defaultEl) defaultEl.setAttributeNS(W_NS, 'w:val', val);
  else { defaultEl = cbEl.ownerDocument.createElementNS(W_NS, 'w:default'); defaultEl.setAttributeNS(W_NS, 'w:val', val); cbEl.appendChild(defaultEl); }
  let checkedEl = cbEl.getElementsByTagNameNS(W_NS, 'checked')[0];
  if (checkedEl) checkedEl.setAttributeNS(W_NS, 'w:val', val);
}

async function fillTemplate(templateKey, expandedData, fieldMap) {
  const arrayBuffer = await window.api.docx.template(`${templateKey}.docx`);
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file('word/document.xml').async('string');
  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, 'application/xml');
  const ffDataList = Array.from(doc.getElementsByTagNameNS(W_NS, 'ffData'));
  for (const field of fieldMap) {
    const { idx, data_key, type } = field;
    if (!data_key || expandedData[data_key] === undefined || expandedData[data_key] === null) continue;
    const value = expandedData[data_key];
    const ff = ffDataList[idx];
    if (!ff) continue;
    if (type === 'text') { const s = String(value); if (s !== '') setTextField(ff, s); }
    else if (type === 'checkbox') setCheckbox(ff, !!value);
  }
  const newXml = new XMLSerializer().serializeToString(doc);
  zip.file('word/document.xml', newXml);
  return await zip.generateAsync({ type: 'blob' });
}

// 4 Formulare befüllen und als ZIP (ArrayBuffer) zurückgeben
async function buildZip(data, fieldMap) {
  const expanded = expandRadio(data);
  const exportZip = new JSZip();
  for (const tpl of ['902.1', '902.4', '902.5', '902.9']) {
    const blob = await fillTemplate(tpl, expanded, fieldMap[tpl]);
    exportZip.file(`${tpl}.docx`, blob);
  }
  return exportZip.generateAsync({ type: 'arraybuffer' });
}

// Export: 4 Formulare als ZIP → nativer Speichern-Dialog
async function exportAll(data, fieldMap) {
  const name = (vpName(data) || 'Unbekannt').replace(/[^a-zA-Z0-9äöüÄÖÜ\- ]/g, '').trim().replace(/ /g, '_');
  const date = data.filler_datum ? data.filler_datum.replace(/-/g, '') : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const zipName = `GwG_${name}_${date}.zip`;
  const content = await buildZip(data, fieldMap);
  return window.api.docx.save(zipName, content);
}

window.KYC = { defaultData, expandRadio, vpName, formatDate, exportAll, buildZip };
