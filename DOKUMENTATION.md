# KYC-Dashboard Scarossa - Dokumentation

Version 2.3.6 · Stand 19.07.2026 · Interne Anwendung (3 Nutzer)

Diese Dokumentation deckt Bedienung, Workflows, Datenhaltung, Sicherheit,
Entwicklung und Fehlerbehebung ab. Für den schnellen Überblick siehe
[README.md](README.md).

---

## Inhalt

1. [Überblick und Zweck](#1-überblick-und-zweck)
2. [Installation und Erststart](#2-installation-und-erststart)
3. [Die Ansichten im Einzelnen](#3-die-ansichten-im-einzelnen)
4. [Workflows](#4-workflows)
5. [Screening im Detail](#5-screening-im-detail)
6. [AML-Report (Bitcoin-ATM)](#6-aml-report-bitcoin-atm)
7. [Datenhaltung und Sicherheit](#7-datenhaltung-und-sicherheit)
8. [Formular-Updates (neue VQF-Vorlagen)](#8-formular-updates-neue-vqf-vorlagen)
9. [Entwicklung](#9-entwicklung)
10. [Fehlerbehebung](#10-fehlerbehebung)
11. [Versionshistorie](#11-versionshistorie)

---

## 1. Überblick und Zweck

Die App bündelt die GwG-/VQF-Pflichten der Scarossa in einer lokalen Desktop-Anwendung:

- **Erfassen**: KYC-Daten einer Vertragspartei einmal eingeben; die vier
  VQF-Formulare 902.1 (Identifizierung), 902.4 (Risikoprofil), 902.5
  (Kundenprofil) und 902.9 (Wirtschaftlich Berechtigter A) werden daraus
  automatisch befüllt.
- **Prüfen**: Jede Person wird regelmässig gegen die SECO-Sanktionsliste
  (Schweiz) und - bei ausländischer Staatsangehörigkeit - gegen dilisense
  (internationale Sanktions-, PEP- und Kriminallisten) geprüft.
- **Auswerten**: Der jährliche Transaktions-Export der Bitcoin-ATMs wird zur
  VQF-Revisionsauswertung verarbeitet (GwG-Schwellenwert CHF 1'000).
- **Nachweisen**: Screening-Nachweise, KYC-Dossiers und der AML-Bericht werden
  als PDF erzeugt; alle Daten bleiben lokal und verschlüsselt.

Grundsatz der App: **Ein möglicher Treffer wird nie automatisch verworfen.**
Treffer werden zur menschlichen Prüfung markiert; erst das manuelle Abhaken
("Als geprüft/ok markieren") beendet die Meldung - und genau diese Entscheidung
wird gespeichert, damit derselbe Treffer nicht jede Woche neu aufschlägt.

---

## 2. Installation und Erststart

### Windows 10/11

1. `KYC-Dashboard Scarossa Setup <Version>.exe` starten.
2. SmartScreen meldet "Unbekannter Herausgeber" (App ist nicht signiert):
   **"Weitere Informationen" → "Trotzdem ausführen"**.
3. Installationsordner wählen, Desktop-Verknüpfung wird angelegt.

### Linux

1. `KYC-Dashboard Scarossa-<Version>.AppImage` ausführbar machen
   (`chmod +x` oder Rechtsklick → Eigenschaften → Ausführbar) und starten.
2. Benötigt `libfuse.so.2` (Arch: Paket `fuse2`).

### Erststart (einmalig)

| Schritt | Wo | Zweck |
|---|---|---|
| SECO-Liste laden | Einstellungen → SECO → "Liste jetzt laden" | Lädt die konsolidierte Schweizer Sanktionsliste (~40 MB) und baut den lokalen Suchindex |
| dilisense prüfen | Einstellungen → dilisense → "Verbindung testen" | Der Firmen-Key ist vorkonfiguriert; der Test verbraucht 1 Abfrage des Kontingents |
| Auto-Screening (optional) | Einstellungen → Automatischer Zeitplan | Wöchentlicher OS-Task, prüft auch bei geschlossener App |

---

## 3. Die Ansichten im Einzelnen

### 3.1 Dashboard

Einstieg mit Schnellzugriffen (Neue KYC-Person, Personen & Suche, Screening,
Formulare importieren) und Statuskacheln:

- **Personen gesamt / Sauber / Zur Prüfung fällig / Mögliche Treffer**
- **KYC veraltet**: Personen, deren Daten seit über einem Jahr nicht
  aktualisiert wurden (VQF erwartet regelmässige Überprüfung der Kundenprofile)
- **GwG ohne KYC**: identifikationspflichtige ATM-Kunden ohne verknüpftes Dossier

Rote/gelbe Banner führen per Klick direkt zur betroffenen Ansicht.

### 3.2 Personen

Liste aller aktiven Personen mit Suche (Name, Firma, Nationalität, GwG-File-Nr.,
VQF-Nr.), Status-Badges und Aktionen pro Zeile:

| Aktion | Wirkung |
|---|---|
| Prüfen | Sofortiges Screening dieser Person |
| Nachweis | Screening-Nachweis als PDF (Datum, Quellen, SECO-Listenstand, Ergebnis) |
| Dossier | Alle erfassten KYC-Daten als strukturiertes PDF |
| Bearbeiten | Öffnet das KYC-Formular mit den gespeicherten Daten |
| ✕ | **Archiviert** die Person (kein Löschen, siehe 7.4) |

Badges: `Ausland` (dilisense-Screening aktiv), `KYC > 1 Jahr` (Aktualisierung
fällig), `Unvollständig` (beim Import fehlten Formulare; Tooltip zeigt welche).

### 3.3 Screening

Zeigt alle Personen mit offenen Treffern. Pro Treffer: Name mit Schreibvarianten,
Quelle (SECO/dilisense), Typ (SANCTION/PEP/CRIMINAL), Geburtsjahr-Abgleich
("Geburtsjahr passt" / "Geburtsjahr abweichend"), Aliase.

- **Neu prüfen**: wiederholt das Screening sofort.
- **Nachweis (PDF)**: exportiert den Prüfnachweis.
- **Als geprüft/ok markieren**: hakt die aktuellen Treffer als False-Positive ab;
  sie werden bei künftigen Läufen nicht erneut gemeldet (nur neue Treffer schon).
- Links öffnen die Originalquellen (SECO-Suche, dilisense) im Browser.

### 3.4 AML-Report

Jährliche VQF-Auswertung der Bitcoin-ATM-Kassageschäfte, siehe Kapitel 6.

### 3.5 KYC-Formular

Die acht Sektionen der Erfassung (Stammdaten, Vertragspartei, Eröffner,
Aufnahme 902.1, WB/902.9, Risikoprofil 902.4, Kundenprofil 902.5, Checkliste)
mit Subnavigation. Besonderheiten:

- **Pflichtfelder**: Fehlt beim Speichern etwas, werden die Felder rot markiert,
  die App scrollt zum ersten Fehler und nennt die Anzahl in der Bottom-Bar.
- **WB-Übernahme**: Ist die Vertragspartei selber wirtschaftlich berechtigt
  (Checkbox in Sektion 5), werden die WB-Personalien automatisch übernommen.
  Zusätzlich gibt es den Button "Von Vertragspartei übernehmen".
- **dilisense-Vorschlag**: Wird eine Nicht-CH-Staatsangehörigkeit eingegeben,
  fragt die App, ob das internationale Screening aktiviert werden soll.
- **Bottom-Bar**: Speichern, "Vorschau & Export", Abbrechen.
- **Kontroll-Vorschau**: Jeder Export zeigt zuerst alle Werte, die in die vier
  Formulare eingetragen werden; erst danach "Als ZIP exportieren".
- **Dirty-Guard**: Verlassen mit ungespeicherten Änderungen wird abgefragt.

Das exportierte ZIP enthält `902.1.docx`, `902.4.docx`, `902.5.docx`,
`902.9.docx`. **902.9 muss ausgedruckt und vom Kunden persönlich unterschrieben
werden.**

### 3.6 Datenbank

Personen und AML-Vorjahres-Auswertungen in einer Ansicht, mit Suche und
CSV-Export.

- **"Verwalten…"** (rechts, dezent): blendet Checkboxen ein. Ausgewählte
  Personen können **archiviert**, ausgewählte AML-Auswertungen gelöscht werden.
- **"Archiv…"** (erscheint nur im Verwalten-Modus): Unterreiter mit allen
  archivierten Personen. Dort ist ausschliesslich **"Wiederherstellen"** möglich;
  ein endgültiges Löschen gibt es bewusst nicht (GwG-Aufbewahrungspflicht,
  10 Jahre).

### 3.7 Einstellungen

| Block | Inhalt |
|---|---|
| dilisense API | Key (vorkonfiguriert, überschreibbar), Verbindungstest, Kontingentanzeige (x/100 Abfragen im Monat) |
| SECO-Sanktionsliste | Download-URL, "Liste jetzt laden", Listenstand und Eintragszahl |
| Screening-Rhythmus | Intervall (3/7/14 Tage; Personen gelten danach als fällig), Fuzzy-Suche an/aus |
| Automatischer Zeitplan | Wochentag/Uhrzeit; legt einen Windows-Task bzw. systemd-User-Timer an, der die App headless startet (auch bei geschlossener App); Systembenachrichtigung bei Treffern |
| App & Daten | Pfad der Datenbank, Verschlüsselungsstatus, Anzahl archivierter Personen, Electron-Version, "Datenordner öffnen" |

Theme-Umschalter (Light/Dark) oben rechts; Light ist Standard.

---

## 4. Workflows

### 4.1 Neue Person erfassen

1. Dashboard → **"Neue KYC-Person erfassen"** (oder Sidebar → KYC-Formular).
2. Sektionen ausfüllen; Erfassungsdatum ist mit heute vorbelegt.
3. **"Person speichern"** (oben oder in der Bottom-Bar). Die Person landet in
   der Datenbank und wird beim nächsten Lauf automatisch gescreent.
4. Optional **"Vorschau & Export"** → Kontroll-Vorschau → ZIP mit den 4 DOCX.

### 4.2 Bestehende Formulare importieren

**Formate**: `.docx` (die vier VQF-Formulare mit Formularfeldern) und `.zip`
(Bündel solcher DOCX, z. B. die Export-ZIPs dieser App). Beides kann per
Drag & Drop ins Fenster gezogen oder über "Formulare importieren" gewählt
werden. **PDF wird nicht unterstützt** (keine auslesbaren Formularfelder).

- **Vollständig** (alle 4 Formulare): Person wird direkt angelegt.
- **Unvollständig** (z. B. nur 902.1 + 902.9): Rückfrage
  *"Die Daten von 'XY' sind unvollständig - es fehlen: … Trotzdem importieren?"*
  Bei Import erhält die Person das Badge **"Unvollständig"**.
- **Duplikat** (gleicher Name + Geburtsdatum oder gleiche GwG-File-Nr.):
  Rückfrage zum **Zusammenführen**. Regel: Es werden nur leere Felder ergänzt;
  bei abweichenden Werten gewinnt immer der bestehende Datensatz (keine
  Vermischung). Werden so fehlende Formulare nachgeliefert, verschwindet das
  "Unvollständig"-Badge.
- Mehrere lose DOCX mit unterschiedlichen Vorlagen werden als **eine** Person
  gruppiert; nicht erkennbare Dateien werden gemeldet und übersprungen.

### 4.3 Person aktualisieren

Personen → Bearbeiten → Felder ändern → Speichern. Das Badge "KYC > 1 Jahr"
verschwindet mit der Aktualisierung.

### 4.4 Exporte

| Export | Wo | Format |
|---|---|---|
| 4 VQF-Formulare | Formular → Vorschau & Export | ZIP mit 4 DOCX |
| KYC-Dossier | Personen/Datenbank → "Dossier" | PDF (A4 hoch) |
| Screening-Nachweis | Personen/Screening → "Nachweis" | PDF (A4 hoch) |
| Personenliste | Personen/Datenbank → "CSV-Export" | CSV (Semikolon, Excel-tauglich); vorher DSG-Bestätigung |
| AML-Bericht | AML-Report → "Als PDF exportieren" | PDF (A4 quer) |

---

## 5. Screening im Detail

### 5.1 Quellen

| Quelle | Abdeckung | Kosten | Für wen |
|---|---|---|---|
| **SECO** | Schweizer Sanktionsliste (konsolidierte XML-Gesamtliste, inkl. aller Schreibvarianten/Aliase) | gratis, kein Key | **immer alle Personen** |
| **dilisense** | Internationale Sanktions-, PEP- und Kriminallisten (REST-API) | 100 Abfragen/Monat gratis, danach kostenpflichtig | Personen mit Markierung "Ausland" |

Die "Ausland"-Markierung wird beim Erfassen/Import aus der Staatsangehörigkeit
abgeleitet (Wortgrenzen-genau: "Chile" ist nicht "CH") und kann im Formular
über den Schalter "Ausländer (dilisense)" manuell gesetzt werden.

### 5.2 Ablauf und Rhythmus

- **Beim App-Start**: alle fälligen Personen (älter als das Intervall,
  Standard 7 Tage) werden automatisch geprüft, sofern die SECO-Liste geladen ist.
- **Manuell**: "Fällige prüfen" (Dashboard/Screening) oder "Prüfen" pro Person.
- **OS-Zeitplan**: wöchentlicher Task startet die App headless (`--screen`).
  Dieser aktualisiert **zuerst die SECO-Liste** (bei Netzfehler: Cache) und
  prüft dann. Läuft die GUI gerade, bricht der Headless-Lauf ab
  (Single-Instance-Schutz, keine parallelen Schreibzugriffe).

### 5.3 Treffer-Handling

- Namensabgleich mit Fuzzy-Toleranz (Tippfehler, Schreibvarianten, kyrillische
  Aliase über die SECO-Varianten).
- Zusatzinfo **Geburtsjahr-Abgleich**, wenn das Geburtsdatum erfasst ist
  ("passt" / "abweichend") - nur zur Einordnung, nie zum automatischen Verwerfen.
- **"Als geprüft/ok markieren"** speichert die Treffer-Schlüssel
  (Quelle + Listen-ID + Name) an der Person; dieselben Treffer werden künftig
  nicht mehr gemeldet, neue Treffer weiterhin.
- Jeder Lauf wird mit Zeitpunkt, Quellen und SECO-Listenstand im
  Screening-Verlauf der Person gespeichert (unbegrenzt, Nachweispflicht).

### 5.4 Status

| Status | Bedeutung |
|---|---|
| Nie geprüft | Person wurde noch nie gescreent |
| Sauber | Letzter Lauf ohne (neue) Treffer |
| Prüfung nötig | Mindestens ein neuer Treffer wartet auf menschliche Prüfung |
| Unvollständig | Eine Quelle war nicht verfügbar (z. B. SECO-Liste nicht geladen) |

---

## 6. AML-Report (Bitcoin-ATM)

### 6.1 Auswertung erzeugen

1. Ansicht **AML-Report** → Prüfer/Revisionsstelle eintragen (erscheint im
   Berichtskopf) → Transaktions-CSV wählen oder ins Fenster ziehen.
2. Unterstützt wird das **Lamassu-Exportformat** (Spalten u. a. `txClass`,
   `fiat`, `status`, `customerId`). Fremde CSV-Formate werden mit klarer
   Meldung abgewiesen.
3. Die App zeigt KPIs und die **Berichtsvorschau** exakt im PDF-Layout.

### 6.2 Berichtsinhalt (validiert gegen den Prüferbericht 2026)

- KPIs: abgeschlossene Transaktionen (Status Sent/Success), eindeutige Kunden,
  Gesamtvolumen, Abbrüche
- **GwG-Kategorisierung** (Grenze CHF 1'000.00): Kunden mit mind. einer
  Transaktion über der Grenze (identifikationspflichtig) vs. ausschliesslich
  darunter; anonymisierte Liste der pflichtigen Kunden (Referenz, Tx-Zahl,
  höchste Tx, Volumen)
- Betragskategorien-Verteilung, monatliche CashIn/CashOut-Übersicht,
  Auswertung pro ATM-Gerät

### 6.3 Speichern, Vorjahre, Verknüpfung

- **"In Datenbank speichern"** legt die Auswertung für den **Jahresvergleich**
  ab (Datenbank-Ansicht und AML-Ansicht zeigen Vorjahre mit Delta zum Vorjahr).
- **GwG-pflichtige ATM-Kunden ↔ KYC-Dossiers**: In der AML-Ansicht kann jeder
  identifikationspflichtige Kunde (per Kunden-Referenz) einem KYC-Dossier
  zugeordnet werden. Das Dashboard zählt Kunden ohne Dossier ("GwG ohne KYC").

---

## 7. Datenhaltung und Sicherheit

### 7.1 Speicherorte

| Was | Wo |
|---|---|
| Datenbank | `<userData>/kyc-datenbank.json` (verschlüsselt) |
| SECO-Suchindex | `<userData>/seco-index.json` |
| Backups | `<userData>/backups/` (rotierend, letzte 7 Stände, bei jedem App-Start) |

`<userData>`: Linux `~/.config/kyc-dashboard-scarossa/`, Windows
`%APPDATA%\kyc-dashboard-scarossa\`. "Datenordner öffnen" in den Einstellungen.

### 7.2 Verschlüsselung

Die gesamte Datenbank (inkl. dilisense-Key) wird mit **Electron safeStorage**
verschlüsselt: Windows über DPAPI, Linux über den Schlüsselbund
(gnome-libsecret/kwallet). Der Schlüssel ist an das Benutzerkonto und die
App-Identität gebunden. Ist kein sicherer Speicher verfügbar, fällt die App auf
Klartext zurück und zeigt dies in den Einstellungen an. Eine bestehende
Klartext-Datenbank wird beim nächsten Start automatisch verschlüsselt.

### 7.3 Härtung

- Renderer läuft in der **Chromium-Sandbox** mit Context-Isolation; Zugriff auf
  das System ausschliesslich über eine schmale, geprüfte IPC-Brücke.
- **CSP** ohne Inline-Scripts; Vorlagen- und Partial-Zugriffe über Whitelists
  (kein Path-Traversal); PDF-Rendering nur aus strukturierten Daten im
  Main-Prozess. `'unsafe-eval'` verbleibt einzig für Alpine.js-Expressions.
- Personennamen werden nirgends als HTML gerendert (XSS-getestet).
- Doppelklick-Schutz auf Speichern/Export; alle Aktionen melden Fehler als
  sichtbare Toasts statt still zu scheitern.

### 7.4 Archiv statt Löschen

"Löschen" verschiebt Personen ins **Archiv** (GwG Art. 7: 10 Jahre
Aufbewahrung). Das Archiv ist über Datenbank → Verwalten… → Archiv… erreichbar
und erlaubt nur das **Wiederherstellen**. AML-Auswertungen können dagegen
gelöscht werden (Rohdaten-CSV bleibt beim Nutzer).

### 7.5 Externe Verbindungen

Die App verbindet sich ausschliesslich mit: SECO (Download der Sanktionsliste),
dilisense (Screening-Abfragen; übertragen wird nur der zu prüfende Name samt
Geburtsdatum) und GitHub (Update-Check der installierten App). KYC-Inhalte
verlassen das Gerät nicht.

---

## 8. Formular-Updates (neue VQF-Vorlagen)

Gibt der VQF eine neue Version eines Formulars heraus:

1. Neue Vorlage nach `templates/` kopieren (z. B. `templates/902.1.docx`).
2. Felder neu extrahieren: `python3 scripts/extract_field_map.py`
   (schreibt `field-map.json` mit Position, Kontext und Daten-Schlüssel je Feld).
3. Mapping prüfen: `context` der Felder mit der alten Version vergleichen;
   verschobene Felder → `data_key` anpassen. Die Felder werden über ihre
   **Ordinalposition** adressiert (Feldnamen sind in den Vorlagen nicht eindeutig).
4. Test: `python3 tests/test_fill.py` → `ALL TESTS PASSED`.
5. Der Import erkennt Vorlagen an der **Feldanzahl** pro Dokument; ändert sich
   diese, funktioniert die Erkennung automatisch mit der neuen field-map.

---

## 9. Entwicklung

### 9.1 Projektstruktur

```
main.js                Electron-Hauptprozess: Fenster, IPC, Headless-Screening,
                       PDF-Rendering (Nachweis/Dossier), Auto-Update, Dev-Hooks
preload.js             IPC-Brücke (contextBridge), einzige API des Renderers
src/
  store.js             Verschlüsselte JSON-Datenbank (Personen, Archiv, Settings,
                       AML-Reports/-Links, dilisense-Kontingent), Backups
  seco.js              SECO-XML laden, Index bauen, lokal screenen
  dilisense.js         dilisense-REST-Client (checkIndividual/checkEntity)
  match.js             Namensnormalisierung, Fuzzy-Matching, Treffer-Schlüssel
  screening.js         Orchestrator (SECO immer, dilisense für Ausland,
                       Whitelist-Filter, Geburtsjahr-Abgleich)
  scheduler.js         OS-Zeitplan (Windows schtasks / systemd --user Timer)
  aml.js               CSV-Parser, Revisions-Aggregation, Berichts-HTML
renderer/
  index.html           App-Shell und Ansichten (~700 Zeilen)
  form-sections.html   Die 8 Formular-Sektionen (Partial, via IPC geladen)
  boot.js              Lädt das Partial, startet danach Alpine
  ui.js                Alpine-App: Views, Validierung, Import/Merge, Vorschau
  docx.js              DOCX-Befüllung (Formularfelder per Ordinalposition)
  import.js            Import-Gegenrichtung: DOCX/ZIP → Datensatz
  theme.css            Design-System (Light/Dark, lokale Fonts)
  lib/                 jszip, alpine, tailwind.css (statisch), Fonts
templates/             VQF-Vorlagen (vertraulich)
field-map.json         Feld-Mapping der Vorlagen
tests/e2e.js           E2E-/Bug-Bounty-Suite (37 Szenarien)
tests/test_fill.py     DOCX-Befüllungstest (Python)
scripts/extract_field_map.py   field-map aus Vorlagen erzeugen
```

### 9.2 Befehle

```bash
npm install                                # Abhängigkeiten
env -u ELECTRON_RUN_AS_NODE npm start      # Dev-Start
npm run css                                # Tailwind statisch neu bauen
env -u ELECTRON_RUN_AS_NODE npm run screen # Headless-Screening (wie OS-Task)
env -u ELECTRON_RUN_AS_NODE npm run dist   # Installer Linux+Windows → release/
```

Hinweis Arch/zsh: Die Umgebung setzt `ELECTRON_RUN_AS_NODE=1`; ohne das
`env -u`-Präfix startet Electron als Node-Prozess statt als GUI.

### 9.3 Dev-Hooks (Umgebungsvariablen)

| Variable | Wirkung |
|---|---|
| `KYC_E2E=1` | E2E-Suite in der echten App ausführen, Ergebnis als `E2E_RESULT=` auf stdout |
| `KYC_SHOT=<dir>` | Screenshots aller Ansichten nach `<dir>` schreiben |
| `KYC_MAKETEST=<dir>` | Befüllte Test-Formulare (ZIPs) über die echte Pipeline erzeugen |
| `KYC_SELFTEST=1` | Import-Round-Trip-Selbsttest |
| `KYC_CLONETEST=1` (+`AML_CSV`) | IPC-Serialisierungs-Test |
| `--amltest` (+`AML_CSV`, `AML_OUT`) | AML-CSV → PDF headless |

Alle Hooks laufen gegen ein frisches `--user-data-dir`, nie gegen die echte
Datenbank.

### 9.4 Tests

- **E2E-Suite** (`tests/e2e.js`, 37 Szenarien): Validierung, Feld-Round-Trip
  über alle ~150 Formularfelder, XSS, Doppelklick-Races, Extremeingaben,
  Import (Schrott/Teilmengen/Duplikate/Zusammenführung), AML-Fehlformate,
  Screening ohne SECO, Archiv-Flow, Dirty-Guard, Theme.
- **DOCX-Fülltest** (`tests/test_fill.py`): prüft die Befüllung aller vier
  Vorlagen gegen die field-map.

### 9.5 Releases und Auto-Update

`npm run dist` baut AppImage (Linux) und NSIS-Setup (Windows) nach `release/`.
Die installierte App prüft beim Start GitHub-Releases
(`xc4pr/kyc-dashboard-scarossa`) und lädt Updates automatisch; ohne
veröffentlichtes Release bleibt der Check still. Für ein Release: Version in
`package.json` erhöhen, bauen, Artefakte als GitHub-Release taggen.

---

## 10. Fehlerbehebung

| Problem | Ursache/Lösung |
|---|---|
| Windows: "Der Computer wurde geschützt" | App unsigniert → "Weitere Informationen" → "Trotzdem ausführen" |
| Linux: AppImage startet nicht | `fuse2` installieren; aus dem Terminal mit `env -u ELECTRON_RUN_AS_NODE ./…AppImage` starten |
| Terminal: "bad option: --…" | `ELECTRON_RUN_AS_NODE` ist gesetzt → mit `env -u ELECTRON_RUN_AS_NODE` starten |
| Screening meldet "Unvollständig" | SECO-Liste nicht geladen → Einstellungen → "Liste jetzt laden" |
| dilisense-Fehler 401/403 | Key ungültig/rotiert → neuen Key in den Einstellungen speichern |
| dilisense übersprungen | Person ist nicht als "Ausland" markiert oder Kontingent (100/Monat) erschöpft |
| Import erkennt Datei nicht | Nur `.docx` mit VQF-Formularfeldern bzw. `.zip` daraus; PDF wird nicht unterstützt |
| AML: "CSV nicht erkannt" | CSV ist kein Lamassu-Export (andere Spalten/Trennzeichen) |
| Datenbank scheint leer | App-Identität/Benutzerkonto gewechselt → safeStorage kann nicht entschlüsseln; auf demselben Konto mit derselben App öffnen |
| Datum zeigt mm/dd/yyyy | Sollte nicht vorkommen (App erzwingt de-CH); App neu starten |
| Wiederherstellung nötig | `<userData>/backups/` enthält die letzten 7 Stände; Datei nach `kyc-datenbank.json` zurückkopieren (bei geschlossener App) |

---

## 11. Versionshistorie

| Version | Inhalt |
|---|---|
| 1.0 | Offline-HTML-Webapp: 4 VQF-Formulare aus einer Eingabemaske (localStorage) |
| 2.0 | Electron-App: Personendatenbank, SECO+dilisense-Screening, OS-Zeitplan, Import per Drag & Drop, AML-Report mit PDF und Jahresvergleich, Scarossa-Branding |
| 2.1 | Verschlüsselung at rest, Hit-Whitelisting, Archiv statt Löschen, Backups, Screening-Nachweis-PDF, IPC-Härtung; Electron 43, statisches Tailwind, Sandbox+CSP; Design v3 (Light-Standard, 10x10-Designsprache); Features: KYC-Aktualität, AML↔KYC-Verknüpfung, Auto-Update, CSV-Export, Dossier-PDF |
| 2.2 | Formular-UX: Pflichtfeld-Validierung, WB-Übernahme, Export-Kontrollvorschau, dilisense-Vorschlag; Datenbank-Reiter mit Verwalten-Modus; E2E-Suite; XSS-/Race-Fixes |
| 2.3 | Archiv-Unterreiter (nur Wiederherstellen); Import: Unvollständigkeits-Erkennung und Zusammenführung ohne Datenvermischung; Textbereinigung |
| **2.3.6** | Dokumentation, dynamische Versionsanzeige, Abschluss-Release |
