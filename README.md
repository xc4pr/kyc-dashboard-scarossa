# KYC-Dashboard Scarossa (v2)

Desktop-App für **VQF/GwG-Compliance**: zentrale Personendatenbank, automatisiertes
Sanktions-/PEP-Screening und Generierung der vier VQF-Formulare (902.1, 902.4, 902.5, 902.9).

Läuft als installierbare Desktop-App auf **Linux** und **Windows 10/11** (Electron).
Alle Daten bleiben lokal auf dem Gerät — kein Server, keine Cloud.

---

## Was v2 gegenüber v1 neu kann

| Bereich | v1 (HTML-Webapp) | v2 (Desktop-App) |
|---|---|---|
| Datenhaltung | 1 Entwurf im Browser | **Datenbank aller KYC-Personen** (lokal, durchsuchbar) |
| Screening | — | **SECO** (Schweizer Embargo) + **dilisense** (int. Sanktionen/PEP) |
| Automatik | — | **Wöchentliches Auto-Screening** (OS-Zeitplan + beim Start) |
| Oberfläche | hell | **Modernes Bitcoin/Finance-Theme, Light + Dark** |
| DOCX-Export | ✓ | ✓ (übernommen) |

---

## Installation (für den Endnutzer)

Fertige Installer werden mit `npm run dist` erzeugt (Ordner `release/`):

- **Windows:** `KYC-Dashboard Scarossa Setup x.y.z.exe` — doppelklicken, installieren, fertig.
- **Linux:** `.AppImage` (ausführbar machen, starten) oder `.deb` (`sudo dpkg -i …`).

Beim ersten Start:
1. **Einstellungen → SECO → „Liste jetzt laden"** (lädt die Schweizer Sanktionsliste, ~40 MB).
2. Optional **dilisense API-Key** eintragen (gratis: 100 Prüfungen/Monat) für Ausländer-Screening.
3. Optional **Automatischer Zeitplan** aktivieren (wöchentlich, auch bei geschlossener App).

---

## Entwicklung

```bash
npm install          # Abhängigkeiten (inkl. Electron)
npm start            # App im Dev-Modus starten
npm run screen       # Headless-Screening-Lauf (wie vom Zeitplan aufgerufen)
npm run dist         # Installer für Linux + Windows bauen → release/
```

> Hinweis Arch/zsh: Ist `ELECTRON_RUN_AS_NODE` in der Umgebung gesetzt, startet Electron
> als Node statt als GUI. Dann mit `env -u ELECTRON_RUN_AS_NODE npm start` starten.

---

## Architektur

```
main.js              Electron-Hauptprozess: Fenster, IPC, Headless-Screening
preload.js           Sichere Bridge (window.api.*) — contextIsolation
src/
  store.js           Lokale JSON-Datenbank (Personen, Einstellungen) in userData
  seco.js            SECO-XML laden, zu Suchindex parsen, lokal abgleichen
  dilisense.js       dilisense REST-API (checkIndividual / checkEntity)
  match.js           Namensnormalisierung + Fuzzy-Abgleich (Levenshtein)
  screening.js       Orchestrator: SECO (immer) + dilisense (Ausländer)
  scheduler.js       OS-Zeitplan: Windows-Aufgabe / systemd-Timer
renderer/
  index.html         App-Shell + 5 Ansichten + portiertes VQF-Formular
  theme.css          Bitcoin/Finance-Design, Light + Dark (CSS-Variablen)
  ui.js              Alpine.js-App (Views, DB-Aufrufe, Screening)
  docx.js            DOCX-Befüllung (aus v1 übernommen)
  lib/               jszip, alpine, tailwind (lokal, offline)
templates/           VQF-Vorlagen (902.1/4/5/9.docx) — nicht bearbeiten
field-map.json       Feld-Mapping der Vorlagen
scripts/, tests/     Werkzeuge zur Pflege des Feld-Mappings (Python)
```

### Screening-Logik

- **SECO** (gratis, kein Key): konsolidierte XML-Gesamtliste wird geladen, zu einem
  kompakten Index geparst und **lokal** gegen jeden Namen abgeglichen. Immer aktiv.
- **dilisense** (Key nötig, Ausländer): REST-Aufruf `checkIndividual`/`checkEntity`.
- **Grundsatz:** Ein möglicher Treffer wird **nie automatisch verworfen**, sondern als
  „Prüfung nötig" markiert und muss von einer Person kontrolliert werden (DSG/GwG).

---

## Datenschutz

Personendaten und der dilisense-Key liegen ausschliesslich lokal im Benutzerprofil
(`userData`). Es werden nur die Sanktionslisten von SECO/dilisense abgerufen — es werden
keine KYC-Daten an Dritte übertragen (dilisense erhält nur den zu prüfenden Namen).
