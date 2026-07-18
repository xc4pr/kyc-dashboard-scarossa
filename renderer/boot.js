'use strict';

// ─── Boot-Loader ──────────────────────────────────────────────────────────────
// Lädt das Formular-Partial (Aufteilung des index.html-Monolithen) über IPC in
// den Mount-Punkt und startet erst DANACH Alpine — so sieht Alpine beim
// Initialisieren bereits den vollständigen DOM.

(async () => {
  try {
    const html = await window.api.app.partial('form-sections.html');
    const mount = document.getElementById('form-sections-mount');
    if (mount) mount.innerHTML = html;
  } catch (e) {
    console.error('Formular-Partial konnte nicht geladen werden:', e);
  }
  const s = document.createElement('script');
  s.src = 'lib/alpine.min.js';
  s.defer = true;
  document.body.appendChild(s);
})();
