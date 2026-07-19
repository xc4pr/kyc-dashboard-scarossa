# KYC-Dashboard Scarossa

Desktop-App für die **VQF/GwG-Compliance** von Scarossa: zentrale Personendatenbank,
automatisiertes Sanktions-/PEP-Screening (SECO + dilisense), jährliche AML-Auswertung
der Bitcoin-ATM-Kassageschäfte und Generierung der vier VQF-Formulare
(902.1, 902.4, 902.5, 902.9).

Läuft als installierbare App auf **Linux** und **Windows 10/11** (Electron 43).
Alle Daten werden lokal auf dem Gerät verarbeitet und **verschlüsselt** gespeichert.

> Ausführliches Handbuch (Bedienung, Workflows, Technik, Troubleshooting):
> **[DOKUMENTATION.md](DOKUMENTATION.md)**

---

## Funktionsumfang

| Bereich | Funktion |
|---|---|
| **KYC-Erfassung** | Einmal eingeben, alle 4 VQF-Formulare befüllen; Pflichtfeld-Validierung mit roter Markierung und Auto-Scroll; WB-Personalien werden von der Vertragspartei übernommen; Kontroll-Vorschau vor jedem Export |
| **Personendatenbank** | Durchsuchbar, verschlüsselt (safeStorage), mit Archiv (GwG-Aufbewahrung) und rotierenden Backups |
| **Import** | Ausgefüllte Formulare (.docx/.zip) per Drag & Drop; erkennt unvollständige Sets (Rückfrage) und führt Duplikate ohne Datenvermischung zusammen |
| **Screening** | SECO-Sanktionsliste (lokal, gratis) + dilisense-API (international, für Ausländer); wöchentlich automatisch (App-Start + OS-Zeitplan); False-Positive-Gedächtnis; Screening-Nachweis als PDF |
| **AML-Report** | Bitcoin-ATM-Transaktions-CSV (Lamassu) → Revisionsbericht mit PDF-Vorschau und Export; Jahresvergleich; Verknüpfung GwG-pflichtiger ATM-Kunden mit KYC-Dossiers |
| **Exporte** | 4 Formulare als DOCX-ZIP, KYC-Dossier-PDF, Screening-Nachweis-PDF, Personenliste als CSV (mit DSG-Hinweis) |

## Schnellstart

1. Installer aus `release/` installieren bzw. AppImage starten
   (Windows: SmartScreen-Hinweis mit "Trotzdem ausführen" bestätigen, App ist unsigniert).
2. **Einstellungen → SECO → "Liste jetzt laden"** (einmalig, ~40 MB).
3. Loslegen: **"Neue KYC-Person erfassen"** oder bestehende Formulare per
   Drag & Drop importieren. Der dilisense-Key ist vorkonfiguriert.

## Entwicklung

```bash
npm install                                  # Abhängigkeiten (inkl. Electron)
env -u ELECTRON_RUN_AS_NODE npm start        # App im Dev-Modus
npm run css                                  # Tailwind neu bauen (nach HTML-Änderungen)
env -u ELECTRON_RUN_AS_NODE npm run dist     # Installer für Linux + Windows → release/
```

E2E-Testsuite (37 Szenarien, fährt die echte App):

```bash
env -u ELECTRON_RUN_AS_NODE KYC_E2E=1 npx electron . --user-data-dir=/tmp/kyc-test
```

Details zu Architektur, Datenhaltung, Sicherheit, Formular-Updates (field-map) und
allen Dev-Hooks: siehe **[DOKUMENTATION.md](DOKUMENTATION.md)**.

## Vertraulichkeit

Interne Anwendung der Scarossa. Die Formularvorlagen (`templates/*.docx`) sind
vertrauliche VQF-Dokumente und dürfen nicht weitergegeben werden. Exportierte
Personenlisten unterliegen dem DSG.
