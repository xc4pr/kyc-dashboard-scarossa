#!/usr/bin/env python3
"""
test_fill.py — Verifies that all 4 DOCX templates can be filled correctly.

Usage: python3 tests/test_fill.py
Output: PASS / FAIL report for each template.
"""
import zipfile
import json
import os
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"

# ─── Fill logic (mirrors app.js) ─────────────────────────────────────────────

def find_parent_p(ffData, root):
    for p in root.iter(f"{{{W}}}p"):
        for r in p:
            if r.tag == f"{{{W}}}r":
                for ff in r.iter(f"{{{W}}}ffData"):
                    if ff is ffData:
                        return p, r
    return None, None


def set_text_field(ffData, value, root):
    p, begin_run = find_parent_p(ffData, root)
    if p is None:
        return False

    runs = [c for c in p if c.tag == f"{{{W}}}r"]
    if begin_run not in runs:
        return False
    begin_idx = runs.index(begin_run)

    for i in range(begin_idx + 1, len(runs)):
        fc_list = runs[i].findall(f"{{{W}}}fldChar")
        if any(fc.get(f"{{{W}}}fldCharType") == "separate" for fc in fc_list):
            if i + 1 >= len(runs):
                return False
            next_run = runs[i + 1]
            end_fc = next_run.findall(f"{{{W}}}fldChar")
            if any(fc.get(f"{{{W}}}fldCharType") == "end" for fc in end_fc):
                # Insert new run before end
                new_r = ET.Element(f"{{{W}}}r")
                t_el = ET.SubElement(new_r, f"{{{W}}}t")
                t_el.text = value
                if " " in value:
                    t_el.set(f"{{{XML_NS}}}space", "preserve")
                idx_in_p = list(p).index(next_run)
                p.insert(idx_in_p, new_r)
            else:
                t_el = next_run.find(f"{{{W}}}t")
                if t_el is None:
                    t_el = ET.SubElement(next_run, f"{{{W}}}t")
                t_el.text = value
                if " " in value:
                    t_el.set(f"{{{XML_NS}}}space", "preserve")
                else:
                    t_el.attrib.pop(f"{{{XML_NS}}}space", None)
            return True
    return False


def set_checkbox(ffData, checked):
    cb_el = ffData.find(f"{{{W}}}checkBox")
    if cb_el is None:
        return False
    val = "1" if checked else "0"
    default_el = cb_el.find(f"{{{W}}}default")
    if default_el is not None:
        default_el.set(f"{{{W}}}val", val)
    else:
        d = ET.SubElement(cb_el, f"{{{W}}}default")
        d.set(f"{{{W}}}val", val)
    return True


def fill_template(template_path, data, field_map_entries):
    with zipfile.ZipFile(template_path) as z:
        names = z.namelist()
        files = {n: z.read(n) for n in names}

    root = ET.fromstring(files["word/document.xml"].decode("utf-8"))
    ffData_list = list(root.iter(f"{{{W}}}ffData"))

    filled_text = 0
    filled_cb = 0
    for field in field_map_entries:
        dk = field["data_key"]
        if not dk or dk not in data:
            continue
        value = data[dk]
        if value is None:
            continue
        idx = field["idx"]
        if idx >= len(ffData_list):
            continue
        ff = ffData_list[idx]
        if field["type"] == "text":
            str_val = str(value)
            if str_val and set_text_field(ff, str_val, root):
                filled_text += 1
        elif field["type"] == "checkbox":
            if set_checkbox(ff, bool(value)):
                filled_cb += 1

    new_xml = ET.tostring(root, encoding="unicode")
    files["word/document.xml"] = new_xml.encode("utf-8")
    return files, filled_text, filled_cb


def verify_output(files, expected_texts, expected_cb_count):
    root = ET.fromstring(files["word/document.xml"].decode("utf-8"))
    doc_texts = " ".join(
        (t.text or "").strip()
        for t in root.iter(f"{{{W}}}t")
        if (t.text or "").strip()
    )

    missing = []
    for val in expected_texts:
        if val not in doc_texts:
            missing.append(val)

    checked = sum(
        1
        for cb in root.iter(f"{{{W}}}checkBox")
        for d in [cb.find(f"{{{W}}}default")]
        if d is not None and d.get(f"{{{W}}}val") == "1"
    )

    return missing, checked


# ─── Test data ────────────────────────────────────────────────────────────────

TEST_DATA = {
    "vqf_mitglied_nr": "TEST-VQF-001",
    "gwg_file_nr": "GwG-2026-001",
    "filler_name": "Anna Beispiel",
    "filler_datum": "21.05.2026",
    "vp_name": "Hans Müller",
    "np_name_vorname": "Hans Müller",
    "np_wohnsitzadresse": "Bahnhofstrasse 1, 8001 Zürich",
    "np_telefon": "044 123 45 67",
    "np_email": "hans.mueller@example.ch",
    "np_geburtsdatum": "15.03.1975",
    "np_staatsangehoerigkeit": "Schweizer",
    "np_identifikationsdokument": "Pass Nr. X12345678",
    "np_ausweiskopie_beigefuegt": True,
    "vertragsschluss_datum": "21.05.2026",
    "aufnahme_persoenlich": True,
    "sprache_deutsch": True,
    "wb_typ_np_selber": True,
    "wb_name": "Müller",
    "wb_vorname": "Hans",
    "wb_geburtsdatum": "15.03.1975",
    "wb_nationalitaet": "Schweizer",
    "wb_wohnsitzadresse": "Bahnhofstrasse 1, 8001 Zürich",
    "pep_ausl_nein": True,
    "pep_inl_nein": True,
    "pep_int_nein": True,
    "high_risk_nein": True,
    "lr_sitz_0": True,
    "lr_geschaeft_0": True,
    "lr_zahlung_0": True,
    "branchenrisiko_0": True,
    "kontaktrisiko_0": True,
    "produktrisiko_0": True,
    "risiko_ohne_erhoehtes": True,
    "kp_beruf": "Kaufmann / Unternehmer",
    "kp_einkommen": "ca. CHF 120000 pro Jahr",
    "kp_zweck": "Vermögensverwaltung",
    "kp_herkunft_detailliert": "Eigene Ersparnisse aus Berufstätigkeit",
    "kp_kategorie_ersparnis": True,
    "dok_vp_cb": True,
    "dok_kundenprofil_cb": True,
    "dok_risikoprofil_cb": True,
    "embargo_pruefung_resultat": "Kein Treffer",
}

EXPECTED_TEXTS_PER_TEMPLATE = {
    "902.1": ["TEST-VQF-001", "GwG-2026-001", "Anna Beispiel", "Hans Müller", "Bahnhofstrasse 1, 8001 Zürich", "Pass Nr. X12345678"],
    "902.4": ["TEST-VQF-001", "GwG-2026-001", "Hans Müller", "Anna Beispiel"],
    "902.5": ["TEST-VQF-001", "GwG-2026-001", "Hans Müller", "Kaufmann / Unternehmer", "Vermögensverwaltung"],
    "902.9": ["TEST-VQF-001", "GwG-2026-001", "Hans Müller", "Müller", "Hans", "Schweizer"],
}


# ─── Run tests ────────────────────────────────────────────────────────────────

def main():
    base = Path(__file__).parent.parent
    with open(base / "field-map.json", encoding="utf-8") as f:
        field_map = json.load(f)

    all_pass = True
    print("=" * 60)
    print("GwG-Dashboard DOCX Fill Test")
    print("=" * 60)

    for tpl_key in ["902.1", "902.4", "902.5", "902.9"]:
        tpl_path = base / "templates" / f"{tpl_key}.docx"
        print(f"\n[{tpl_key}] {tpl_path.name}")

        if not tpl_path.exists():
            print(f"  ERROR: template not found")
            all_pass = False
            continue

        try:
            files, filled_text, filled_cb = fill_template(tpl_path, TEST_DATA, field_map[tpl_key])
        except Exception as e:
            print(f"  ERROR during fill: {e}")
            all_pass = False
            continue

        print(f"  Filled: {filled_text} text fields, {filled_cb} checkboxes")

        expected = EXPECTED_TEXTS_PER_TEMPLATE[tpl_key]
        missing, checked = verify_output(files, expected, 0)

        if missing:
            print(f"  FAIL: Missing values in output: {missing}")
            all_pass = False
        else:
            print(f"  Text values: OK (all {len(expected)} expected values found)")

        print(f"  Checkboxes set to 1: {checked}")

        # Save output for manual inspection
        out_path = Path("/tmp") / f"test_{tpl_key.replace('.', '_')}.docx"
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for name, data_bytes in files.items():
                zout.writestr(name, data_bytes)
        print(f"  Output: {out_path}")

    print("\n" + "=" * 60)
    if all_pass:
        print("RESULT: ALL TESTS PASSED")
    else:
        print("RESULT: SOME TESTS FAILED")
    print("=" * 60)
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
