'use strict';

// ─── Alpine-App: Views, Datenbank, Screening ──────────────────────────────────

// Alpine-Proxies können nicht per Structured Clone über IPC (Electron-Sandbox).
// Alles, was an window.api.* geht, vorher in plain JSON umwandeln.
function plain(x) { return x === undefined ? x : JSON.parse(JSON.stringify(x)); }

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    // Views / Theme
    view: 'dashboard',
    theme: 'light',
    toast: null,

    // KYC-Formular
    data: window.KYC.defaultData(),
    foreign: false,
    currentPersonId: null,
    activeSection: 'stammdaten',
    exporting: false,
    exportError: null,
    fieldMap: null,
    sections: [
      { id: 'stammdaten', label: 'Stammdaten' },
      { id: 'vertragspartei', label: 'Vertragspartei' },
      { id: 'eroeffner', label: 'Eröffner (JP)' },
      { id: 'aufnahme', label: 'Aufnahme 902.1' },
      { id: 'wb', label: 'WB / 902.9' },
      { id: 'risikoprofil', label: 'Risikoprofil 902.4' },
      { id: 'kundenprofil', label: 'Kundenprofil 902.5' },
      { id: 'checkliste', label: 'Checkliste' }
    ],

    // Datenbank / Status
    persons: [],
    query: '',
    settings: { dilisenseApiKey: '', secoUrl: '', screeningIntervalDays: 7, fuzzy: true, theme: 'dark' },
    secoMeta: { ready: false, listDate: null, entryCount: 0, lastDownload: null },
    scheduler: { installed: false },
    appInfo: { platform: '', versions: {} },
    schedDay: 'Mon',
    schedTime: '09:00',

    // Import (Drag & Drop)
    dragOver: false, importing: false,

    // AML-Auswertung
    amlResult: null, amlBusy: false, amlPruefer: '', amlReports: [],

    // Dirty-Check + dilisense-Kontingent + AML-Links
    _formSnap: '', dilisenseUsage: { month: '', count: 0 }, amlLinks: {},

    // Busy-Flags
    screenBusy: false, secoBusy: false, diliBusy: false,
    progress: { done: 0, total: 0 },
    lastRun: null,
    diliMsg: { ok: false, text: '' },

    async init() {
      this.settings = await window.api.settings.get();
      this.theme = this.settings.theme || 'light';
      this.applyTheme();
      this.fieldMap = await window.api.docx.fieldmap();
      await this.reload();
      this.secoMeta = await window.api.seco.meta();
      this.scheduler = await window.api.scheduler.status();
      this.appInfo = await window.api.app.info();
      this.amlReports = await window.api.aml.list();
      this.dilisenseUsage = await window.api.dilisense.usage();
      this.amlLinks = await window.api.aml.links();
      window.api.screening.onProgress(d => { this.progress = d; });
      // App-Schliessen bei ungespeichertem Formular abfangen
      window.addEventListener('beforeunload', (e) => {
        if (this.isFormDirty()) { e.preventDefault(); e.returnValue = ''; }
      });

      // Auto-Screening beim Start: nur fällige Personen (throttelt sich selbst
      // über das Intervall). Nur wenn SECO-Liste geladen ist.
      if (this.secoMeta.ready && this.dueCount > 0) {
        this.screenDue(true);
      }
    },

    async reload() {
      this.persons = await window.api.persons.list();
      try { this.dilisenseUsage = await window.api.dilisense.usage(); } catch (_) {}
    },

    // ── Computed ──
    get filteredPersons() {
      const q = this.query.trim().toLowerCase();
      let list = this.persons.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      if (!q) return list;
      return list.filter(p => {
        const id = p.identity || {};
        const k = p.kyc || {};
        return [id.displayName, id.nationality, id.country, id.dob, k.gwg_file_nr, k.vqf_mitglied_nr]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      });
    },
    get foreignCount() { return this.persons.filter(p => p.foreign).length; },
    get clearCount() { return this.persons.filter(p => p.screeningStatus === 'clear').length; },
    get reviewCount() { return this.persons.filter(p => p.screeningStatus === 'review').length; },
    get flaggedPersons() { return this.persons.filter(p => p.screeningStatus === 'review'); },
    get dueCount() {
      const days = this.settings.screeningIntervalDays || 7;
      const cutoff = Date.now() - days * 86400000;
      return this.persons.filter(p => !p.lastScreenedAt || new Date(p.lastScreenedAt).getTime() < cutoff).length;
    },
    // KYC-Aktualisierung (VQF: Kundenprofile regelmässig überprüfen) — älter als 1 Jahr
    kycStale(p) {
      const ref = p.updatedAt || p.createdAt;
      return ref ? (Date.now() - new Date(ref).getTime()) > 365 * 86400000 : false;
    },
    get staleKycCount() { return this.persons.filter(p => this.kycStale(p)).length; },
    // AML↔KYC: GwG-pflichtige ATM-Kunden aus dem neuesten gespeicherten Report
    get gwgCustomers() {
      const latest = this.amlReportsSorted[0];
      return (latest && latest.agg && latest.agg.gwgList) || [];
    },
    get gwgUnlinkedCount() {
      return this.gwgCustomers.filter(c => !this.amlLinks[c.ref]).length;
    },
    personName(id) {
      const p = this.persons.find(x => x.id === id);
      return p ? (p.identity.displayName || '?') : '?';
    },

    // ── Theme ──
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme();
      this.settings.theme = this.theme;
      window.api.settings.set({ theme: this.theme });
    },
    applyTheme() { document.documentElement.setAttribute('data-theme', this.theme); },

    // ── Formular / Personen ──
    newPerson() {
      this.data = window.KYC.defaultData();
      this.foreign = false;
      this.currentPersonId = null;
      this.activeSection = 'stammdaten';
      this.exportError = null;
      this._formSnap = this.snapForm();
      this.view = 'form';
    },
    openPerson(id) {
      const p = this.persons.find(x => x.id === id);
      if (!p) return;
      this.data = Object.assign(window.KYC.defaultData(), p.kyc || {});
      this.foreign = !!p.foreign;
      this.currentPersonId = p.id;
      this.activeSection = 'stammdaten';
      this.exportError = null;
      this._formSnap = this.snapForm();
      this.view = 'form';
    },
    cancelForm() { this.view = this.currentPersonId ? 'persons' : 'dashboard'; },
    KYCname() { return window.KYC.vpName(this.data); },

    async savePerson() {
      if (!this.KYCname()) { this.showToast('warn', 'Bitte mindestens Name oder Firma der Vertragspartei erfassen.'); return; }
      const rec = await window.api.persons.save(plain({ id: this.currentPersonId, kyc: this.data, foreign: this.foreign }));
      this.currentPersonId = rec.id;
      this._formSnap = this.snapForm();   // gespeichert → nicht mehr dirty
      await this.reload();
      this.showToast('ok', 'Person gespeichert: ' + (rec.identity.displayName || ''));
      this.view = 'persons';
    },
    async deletePerson(p) {
      if (!confirm('Person „' + (p.identity.displayName || '') + '" archivieren?\n\nSie wird aus der aktiven Liste entfernt, aber wegen der GwG-Aufbewahrungspflicht (10 Jahre) im Archiv aufbewahrt.')) return;
      await window.api.persons.remove(p.id);
      await this.reload();
      this.showToast('ok', 'Person archiviert (aufbewahrt).');
    },
    async clearReview(p) {
      // Aktuelle Treffer als False-Positive merken → beim nächsten Lauf nicht neu flaggen
      const last = (p.screenings || [])[0];
      const keys = last && last.hits ? last.hits.map(h => h.key).filter(Boolean) : [];
      await window.api.screening.clearHits(p.id, plain(keys));
      await this.reload();
      this.showToast('ok', 'Als geprüft markiert — dieser Treffer wird nicht erneut gemeldet.');
    },
    async screeningProof(p) {
      try {
        const r = await window.api.screening.proofPdf(p.id);
        if (r && r.saved) this.showToast('ok', 'Nachweis gespeichert: ' + r.path);
      } catch (e) { this.showToast('danger', 'Nachweis fehlgeschlagen: ' + e.message); }
    },

    // ── Screening ──
    async screenPerson(id) {
      this.screenBusy = true;
      try {
        const r = await window.api.screening.person(id);
        await this.reload();
        if (r.status === 'review') this.showToast('warn', 'Möglicher Treffer — bitte prüfen.');
        else if (r.status === 'error') this.showToast('warn', r.summary);
        else this.showToast('ok', 'Keine Treffer.');
      } catch (e) { this.showToast('danger', 'Fehler: ' + e.message); }
      finally { this.screenBusy = false; }
    },
    async screenDue(quiet) {
      this.screenBusy = true;
      this.progress = { done: 0, total: this.dueCount };
      try {
        const res = await window.api.screening.due();
        await this.reload();
        this.lastRun = { checked: res.checked, reviewCount: res.results.filter(r => r.status === 'review').length };
        if (!quiet) {
          if (this.lastRun.reviewCount > 0) this.showToast('warn', this.lastRun.reviewCount + ' Person(en) mit möglichem Treffer.');
          else this.showToast('ok', res.checked + ' geprüft, keine Treffer.');
        } else if (this.lastRun.reviewCount > 0) {
          this.showToast('warn', 'Auto-Screening: ' + this.lastRun.reviewCount + ' mögliche(r) Treffer.');
        }
      } catch (e) { this.showToast('danger', 'Screening-Fehler: ' + e.message); }
      finally { this.screenBusy = false; }
    },
    async refreshSeco() {
      this.secoBusy = true;
      try {
        this.secoMeta = await window.api.seco.refresh();
        this.showToast('ok', 'SECO-Liste geladen: ' + (this.secoMeta.entryCount || 0).toLocaleString('de-CH') + ' Einträge (Stand ' + (this.secoMeta.listDate || '?') + ').');
      } catch (e) { this.showToast('danger', 'SECO-Download fehlgeschlagen: ' + e.message); }
      finally { this.secoBusy = false; }
    },

    // ── Einstellungen ──
    async saveSettings() {
      this.settings = await window.api.settings.set(plain(this.settings));
      this.showToast('ok', 'Einstellungen gespeichert.');
    },
    async testDilisense() {
      this.diliBusy = true; this.diliMsg = { ok: false, text: '' };
      try {
        await window.api.settings.set(plain({ dilisenseApiKey: this.settings.dilisenseApiKey }));
        const r = await window.api.dilisense.test(this.settings.dilisenseApiKey);
        await this.loadUsage();
        this.diliMsg = { ok: true, text: 'Verbindung ok (Testabfrage lieferte ' + r.total_hits + ' Treffer).' };
      } catch (e) { this.diliMsg = { ok: false, text: e.message }; }
      finally { this.diliBusy = false; }
    },
    async installSchedule() {
      try {
        await window.api.settings.set(plain(this.settings));
        await window.api.scheduler.install({ day: this.schedDay, time: this.schedTime });
        this.scheduler = await window.api.scheduler.status();
        this.showToast('ok', 'Automatisches Screening aktiviert (' + this.schedDay + ' ' + this.schedTime + ').');
      } catch (e) { this.showToast('danger', 'Zeitplan fehlgeschlagen: ' + e.message); }
    },
    async removeSchedule() {
      try { await window.api.scheduler.remove(); this.scheduler = await window.api.scheduler.status(); this.showToast('ok', 'Automatik deaktiviert.'); }
      catch (e) { this.showToast('danger', e.message); }
    },

    // ── DOCX-Export (Formular) ──
    async doExport() {
      this.exporting = true; this.exportError = null;
      try {
        const r = await window.KYC.exportAll(this.data, this.fieldMap);
        if (r && r.saved) this.showToast('ok', 'ZIP gespeichert: ' + r.path);
      } catch (e) { this.exportError = e.message; }
      finally { this.exporting = false; }
    },
    // vom Formular erwartete Helfer
    setPep(key, ja) { this.data[key + '_ja'] = ja; this.data[key + '_nein'] = !ja; },
    setRisiko(ohne) { this.data.risiko_ohne_erhoehtes = ohne; this.data.risiko_mit_erhoehtem = !ohne; },

    // ── Import ausgefüllter Formulare (Drag & Drop / Dateiauswahl) ──
    async onDrop(e) {
      this.dragOver = false;
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      if (!files.length) return;
      const csv = files.filter(f => /\.csv$/i.test(f.name));
      const kyc = files.filter(f => /\.(docx|zip)$/i.test(f.name));
      if (csv.length) await this.amlAnalyzeFile(csv[0]);
      if (kyc.length) await this.importFiles(kyc);
      if (!csv.length && !kyc.length) this.showToast('warn', 'Nicht unterstützt. KYC: .docx/.zip · AML: .csv');
    },
    async onFilePick(e) {
      const files = e.target.files;
      if (files && files.length) await this.importFiles(files);
      e.target.value = '';   // erneutes Wählen derselben Datei erlauben
    },
    async importFiles(fileList) {
      this.importing = true;
      try {
        const res = await window.KYCImport.importFileList(fileList, this.fieldMap);
        let saved = 0, updated = 0, skipped = 0;
        for (const p of res.persons) {
          if (!window.KYC.vpName(p.data)) continue;   // ohne Namen überspringen
          const dup = this.findDupLocal(p.data);
          if (dup) {
            const name = window.KYC.vpName(p.data);
            if (!confirm(`„${name}" ist bereits erfasst. Bestehenden Datensatz mit den importierten Daten aktualisieren?\n\n[OK] = aktualisieren · [Abbrechen] = überspringen`)) { skipped++; continue; }
            await window.api.persons.save(plain({ id: dup.id, kyc: p.data }));
            updated++;
          } else {
            await window.api.persons.save(plain({ kyc: p.data }));
            saved++;
          }
        }
        await this.reload();
        const parts = [];
        if (saved) parts.push(saved + ' neu importiert');
        if (updated) parts.push(updated + ' aktualisiert');
        if (skipped) parts.push(skipped + ' übersprungen');
        if (res.skipped.length) parts.push(res.skipped.length + ' Datei(en) nicht erkannt');
        if (!saved && !updated && !skipped && !res.skipped.length) parts.push('Keine verwertbaren Formulare gefunden');
        this.showToast((saved || updated) ? 'ok' : 'warn', parts.join(' · '));
        if (saved || updated) this.view = 'persons';
      } catch (err) {
        this.showToast('danger', 'Import fehlgeschlagen: ' + err.message);
      } finally {
        this.importing = false;
      }
    },

    // ── AML-Auswertung (Kassageschäfte) ──
    async onAmlPick(e) {
      const f = e.target.files && e.target.files[0];
      if (f) await this.amlAnalyzeFile(f);
      e.target.value = '';
    },
    async amlAnalyzeFile(file) {
      this.amlBusy = true;
      try {
        // Datei-Inhalt im Renderer lesen (robust über alle Electron-Versionen)
        const payload = { name: file.name, pruefer: this.amlPruefer, text: await file.text() };
        this.amlResult = await window.api.aml.analyze(payload);
        this.view = 'aml';
        await this.amlLoadList();
      } catch (err) {
        this.showToast('danger', 'AML-Analyse fehlgeschlagen: ' + err.message);
      } finally { this.amlBusy = false; }
    },
    async amlExportPdf() {
      if (!this.amlResult) return;
      this.amlBusy = true;
      try {
        const jahr = (this.amlResult.agg.periodTo || '').slice(0, 4);
        const r = await window.api.aml.exportPdf(plain(this.amlResult.agg), { pruefer: this.amlPruefer }, 'AML_Revision_Bericht_' + jahr + '.pdf');
        if (r.saved) this.showToast('ok', 'PDF gespeichert: ' + r.path);
      } catch (e) { this.showToast('danger', 'PDF-Export fehlgeschlagen: ' + e.message); }
      finally { this.amlBusy = false; }
    },
    async amlSaveReport() {
      if (!this.amlResult) return;
      const a = this.amlResult.agg;
      await window.api.aml.save(plain({
        label: (a.periodTo || '').slice(0, 4), periodFrom: a.periodFrom, periodTo: a.periodTo,
        pruefer: this.amlPruefer, sourceFile: this.amlResult.sourceFile, agg: a
      }));
      await this.amlLoadList();
      this.showToast('ok', 'Auswertung in Datenbank gespeichert.');
    },
    async amlLoadList() { this.amlReports = await window.api.aml.list(); },
    async amlOpenSaved(r) {
      this.amlBusy = true;
      try {
        const html = await window.api.aml.render(plain(r.agg), { pruefer: r.pruefer });
        this.amlPruefer = r.pruefer || '';
        this.amlResult = { agg: r.agg, html, records: r.agg.kpis.completed + r.agg.kpis.cancelled, sourceFile: r.sourceFile };
      } finally { this.amlBusy = false; }
    },
    async amlDelete(r) {
      if (!confirm('Auswertung „' + r.label + '" löschen?')) return;
      await window.api.aml.remove(r.id);
      await this.amlLoadList();
      this.showToast('ok', 'Auswertung gelöscht.');
    },
    get amlReportsSorted() { return this.amlReports.slice().sort((a, b) => (b.periodTo || '').localeCompare(a.periodTo || '')); },
    deltaBadge(i) {
      const list = this.amlReportsSorted;
      const cur = list[i], prev = list[i + 1];
      if (!prev) return '<span class="muted small">—</span>';
      const d = cur.agg.kpis.totalVolume - prev.agg.kpis.totalVolume;
      const pct = prev.agg.kpis.totalVolume ? (d / prev.agg.kpis.totalVolume * 100) : 0;
      const up = d >= 0;
      const col = up ? 'var(--ok)' : 'var(--danger)';
      return '<span style="color:' + col + ';font-weight:600">' + (up ? '▲ +' : '▼ ') + this.chf(d) + ' (' + (up ? '+' : '') + pct.toFixed(1) + '%)</span>';
    },
    chf(n) {
      const s = (Math.round((n || 0) * 100) / 100).toFixed(2);
      const [int, dec] = s.split('.');
      const sign = int.startsWith('-') ? '-' : '';
      return sign + int.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, "'") + '.' + dec;
    },
    fmtD(iso) { if (!iso) return '—'; const d = iso.slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}.${d[1]}.${d[0]}` : iso; },
    async loadUsage() { try { this.dilisenseUsage = await window.api.dilisense.usage(); } catch (_) {} },

    findDupLocal(data) {
      const name = (window.KYC.vpName(data) || '').toLowerCase().trim();
      if (!name) return null;
      const dob = data.np_geburtsdatum || '';
      const gwg = (data.gwg_file_nr || '').toLowerCase().trim();
      return this.persons.find(p => {
        const k = p.kyc || {}, pid = p.identity || {};
        if (gwg && (k.gwg_file_nr || '').toLowerCase().trim() === gwg) return true;
        return (pid.displayName || '').toLowerCase().trim() === name && (pid.dob || '') === dob;
      }) || null;
    },

    // ── Formular-Dirty-Check (Datenverlust vermeiden) ──
    snapForm() { return JSON.stringify({ d: this.data, f: this.foreign }); },
    isFormDirty() { return this.view === 'form' && this._formSnap !== this.snapForm(); },
    navTo(v) {
      if (this.isFormDirty() && v !== 'form') {
        if (!confirm('Das Formular hat ungespeicherte Änderungen. Ohne Speichern verlassen?')) return;
      }
      this.view = v;
    },

    // ── CSV-Export (DSG-Hinweis!) ──
    async exportCsv() {
      if (!confirm('Personenliste als CSV exportieren?\n\n⚠ DSG-Hinweis: Die Datei enthält Personendaten. Vor einer Weitergabe an Dritte muss die Zulässigkeit geklärt sein (Datenschutzgesetz).')) return;
      try {
        const r = await window.api.persons.exportCsv();
        if (r.saved) this.showToast('ok', r.count + ' Person(en) exportiert: ' + r.path);
      } catch (e) { this.showToast('danger', 'Export fehlgeschlagen: ' + e.message); }
    },

    // ── KYC-Dossier als PDF ──
    async dossierPdf(p) {
      try {
        const r = await window.api.persons.dossierPdf(p.id);
        if (r.saved) this.showToast('ok', 'Dossier gespeichert: ' + r.path);
      } catch (e) { this.showToast('danger', 'Dossier fehlgeschlagen: ' + e.message); }
    },

    // ── AML↔KYC-Verknüpfung ──
    async linkGwgCustomer(ref, personId) {
      this.amlLinks = await window.api.aml.link(ref, personId || null);
      this.showToast('ok', personId ? 'Kunde mit KYC-Dossier verknüpft.' : 'Verknüpfung entfernt.');
    },

    // ── Diverses ──
    openExt(url) { window.api.app.openExternal(url); },
    openDataDir() { window.api.app.openDataDir(); },
    showToast(kind, msg) { this.toast = { kind, msg }; clearTimeout(this._t); this._t = setTimeout(() => this.toast = null, 4200); },

    typLabel(p) {
      const t = (p.kyc && p.kyc.vp_typ) || 'np';
      return { np: 'Natürl. Person', eu: 'Einzelunternehmen', jp: 'Jurist. Person' }[t] || t;
    },
    statusBadge(s) {
      const m = { never: 'Nie geprüft', clear: 'Sauber', review: 'Prüfung nötig', error: 'Unvollständig', hit: 'Treffer' };
      return '<span class="dot"></span>' + (m[s] || s);
    },
    geburt(iso) { return window.KYC.formatDate(iso) || iso || ''; },
    fmtDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('de-CH'); } catch { return iso; } },
    fmtDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('de-CH'); } catch { return iso; } }
  }));
});
