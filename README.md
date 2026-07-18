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
| Import | — | **Drag & Drop** bestehender Formulare (.docx/.zip) → Datenbank |
| AML-Report | — | **Bitcoin-ATM-Auswertung**: CSV → Revisionsbericht (PDF) + Jahresvergleich |
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

### Import bestehender Formulare

Ausgefüllte VQF-Formulare (`902.1/4/5/9.docx`) oder die Export-ZIPs dieses Systems
können per **Drag & Drop** (oder „Formulare importieren") ins Fenster gezogen werden.
`renderer/import.js` kehrt die Befüllung um: es liest die Legacy-Formularfelder an ihrer
Ordinalposition aus, mappt sie via `field-map.json` zurück auf die Daten-Schlüssel und legt
die Person automatisch in der Datenbank an (Name/Adresse werden wieder getrennt, Datums- und
Radiofelder zurückgerechnet, Vertragspartei-Typ abgeleitet). Gescannte PDFs ohne
Formularfelder werden nicht unterstützt.

### AML-Report (Bitcoin-ATM-Kassageschäfte)

Für die jährliche VQF/AML-Revision: den Transaktions-CSV-Export des ATM-Systems
(Lamassu/GeneralBytes) per Drag & Drop oder Dateiauswahl in die Ansicht „AML-Report"
geben. `src/aml.js` wertet lokal aus und erzeugt den Revisionsbericht:

- KPIs (abgeschlossene Tx, eindeutige Kunden, Gesamtvolumen, Abbrüche)
- **GwG-Schwellenwert-Kategorisierung** (Grenze CHF 1'000): Kunden mit mind. 1 Tx > 1'000
  (identifikationspflichtig) vs. ausschliesslich ≤ 1'000
- Betragskategorien-Verteilung, monatliche CashIn/CashOut-Übersicht, Auswertung pro ATM

Der Bericht wird als **PDF-Vorschau** angezeigt und via `printToPDF` (A4 quer) exportiert.
Jede Auswertung kann in der Datenbank gespeichert werden → **Jahresvergleich** (Δ Vorjahr).
Methodik: abgeschlossen = Status `Sent`/`Success`, Kunde = `customerId`, Betrag = `fiat`.

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
