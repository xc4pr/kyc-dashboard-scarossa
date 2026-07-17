'use strict';

// ─── Alpine-App: Views, Datenbank, Screening ──────────────────────────────────

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    // Views / Theme
    view: 'dashboard',
    theme: 'dark',
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

    // Busy-Flags
    screenBusy: false, secoBusy: false, diliBusy: false,
    progress: { done: 0, total: 0 },
    lastRun: null,
    diliMsg: { ok: false, text: '' },

    async init() {
      this.settings = await window.api.settings.get();
      this.theme = this.settings.theme || 'dark';
      this.applyTheme();
      this.fieldMap = await window.api.docx.fieldmap();
      await this.reload();
      this.secoMeta = await window.api.seco.meta();
      this.scheduler = await window.api.scheduler.status();
      this.appInfo = await window.api.app.info();
      window.api.screening.onProgress(d => { this.progress = d; });

      // Auto-Screening beim Start: nur fällige Personen (throttelt sich selbst
      // über das Intervall). Nur wenn SECO-Liste geladen ist.
      if (this.secoMeta.ready && this.dueCount > 0) {
        this.screenDue(true);
      }
    },

    async reload() {
      this.persons = await window.api.persons.list();
    },

    // ── Computed ──
    get filteredPersons() {
      const q = this.query.trim().toLowerCase();
      let list = this.persons.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      if (!q) return list;
      return list.filter(p => {
        const id = p.identity || {};
        return [id.displayName, id.nationality, id.country, id.dob].filter(Boolean).join(' ').toLowerCase().includes(q);
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
      this.view = 'form';
    },
    cancelForm() { this.view = this.currentPersonId ? 'persons' : 'dashboard'; },
    KYCname() { return window.KYC.vpName(this.data); },

    async savePerson() {
      if (!this.KYCname()) { this.showToast('warn', 'Bitte mindestens Name oder Firma der Vertragspartei erfassen.'); return; }
      const rec = await window.api.persons.save({ id: this.currentPersonId, kyc: this.data, foreign: this.foreign });
      this.currentPersonId = rec.id;
      await this.reload();
      this.showToast('ok', 'Person gespeichert: ' + (rec.identity.displayName || ''));
      this.view = 'persons';
    },
    async deletePerson(p) {
      if (!confirm('Person „' + (p.identity.displayName || '') + '" wirklich löschen?')) return;
      await window.api.persons.remove(p.id);
      await this.reload();
      this.showToast('ok', 'Person gelöscht.');
    },
    async clearReview(p) {
      await window.api.persons.save({ id: p.id, kyc: p.kyc, foreign: p.foreign, screeningStatus: 'clear', screeningSummary: 'Manuell als geprüft/ok markiert' });
      await this.reload();
      this.showToast('ok', 'Als geprüft markiert.');
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
      this.settings = await window.api.settings.set(this.settings);
      this.showToast('ok', 'Einstellungen gespeichert.');
    },
    async testDilisense() {
      this.diliBusy = true; this.diliMsg = { ok: false, text: '' };
      try {
        await window.api.settings.set({ dilisenseApiKey: this.settings.dilisenseApiKey });
        const r = await window.api.dilisense.test(this.settings.dilisenseApiKey);
        this.diliMsg = { ok: true, text: 'Verbindung ok (Testabfrage lieferte ' + r.total_hits + ' Treffer).' };
      } catch (e) { this.diliMsg = { ok: false, text: e.message }; }
      finally { this.diliBusy = false; }
    },
    async installSchedule() {
      try {
        await window.api.settings.set(this.settings);
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
