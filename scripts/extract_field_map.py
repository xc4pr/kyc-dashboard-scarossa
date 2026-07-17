#!/usr/bin/env python3
"""
extract_field_map.py — Extracts legacy form fields from VQF DOCX templates
and generates field-map.json skeleton.

Usage: python3 scripts/extract_field_map.py
Output: field-map.json (data_key fields start as null — fill in manually)
"""
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

TEMPLATES = {
    "902.1": "templates/902.1.docx",
    "902.4": "templates/902.4.docx",
    "902.5": "templates/902.5.docx",
    "902.9": "templates/902.9.docx",
}


def get_row_context(el, root):
    """Return text from the table row containing this ffData element."""
    for tr in root.iter(f"{{{W}}}tr"):
        for child in tr.iter(f"{{{W}}}ffData"):
            if child is el:
                cells = []
                for tc in tr.iter(f"{{{W}}}tc"):
                    cell_texts = [
                        (t.text or "").strip()
                        for t in tc.iter(f"{{{W}}}t")
                        if (t.text or "").strip()
                    ]
                    if cell_texts:
                        cells.append("|".join(cell_texts))
                return " || ".join(cells)[:150]
    # Fallback: surrounding paragraph
    for p in root.iter(f"{{{W}}}p"):
        for child in p.iter(f"{{{W}}}ffData"):
            if child is el:
                texts = [
                    (t.text or "").strip()
                    for t in p.iter(f"{{{W}}}t")
                    if (t.text or "").strip()
                ]
                return " ".join(texts)[:150]
    return ""


def extract_fields(docx_path):
    with zipfile.ZipFile(docx_path) as z:
        with z.open("word/document.xml") as f:
            content = f.read()
    root = ET.fromstring(content)
    fields = []
    for idx, ff in enumerate(root.iter(f"{{{W}}}ffData")):
        name_el = ff.find(f"{{{W}}}name")
        name = name_el.get(f"{{{W}}}val") if name_el is not None else ""
        is_checkbox = ff.find(f"{{{W}}}checkBox") is not None
        field_type = "checkbox" if is_checkbox else "text"
        context = get_row_context(ff, root)
        fields.append(
            {
                "idx": idx,
                "name": name,
                "type": field_type,
                "context": context,
                "data_key": None,
            }
        )
    return fields


def main():
    result = {}
    for key, path in TEMPLATES.items():
        if not Path(path).exists():
            print(f"WARNING: {path} not found, skipping.")
            continue
        fields = extract_fields(path)
        result[key] = fields
        cb = sum(1 for f in fields if f["type"] == "checkbox")
        tx = sum(1 for f in fields if f["type"] == "text")
        print(f"{key}: {len(fields)} fields ({cb} checkboxes, {tx} text)")
        for f in fields:
            marker = "[cb]" if f["type"] == "checkbox" else "[tx]"
            print(f"  {f['idx']:3d} {marker} {f['name']:25s} {f['context']}")
        print()

    out = Path("field-map.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"Written: {out}")


if __name__ == "__main__":
    main()
