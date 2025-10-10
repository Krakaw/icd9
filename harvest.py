#!/usr/bin/env python3
"""
icd9_build_rich_json.py
Builds a single JSON with ICD-9-CM diagnoses (incl. V/E) + procedures using
**NLM Clinical Table Search Service** long titles, and enriches with consumer-friendly
synonyms from the Clinical “conditions” table when available.

Output: icd9.rich.json (compact one-line JSON)
Python: 3.9+ (stdlib only). No keys, no UMLS account needed.

Structure per record:
  {
    "code": "296.20",
    "kind": "dx",                    # "dx" | "proc"
    "name": "Major depressive disorder, single episode, unspecified",
    "short": "Maj depress dis, single eps, unsp",   # may be empty if not provided
    "syn": ["Depression", "MDD", ...]               # from NLM conditions (if any)
  }
"""
import json, math, time, urllib.parse, urllib.request, sys

DX_BASE = "https://clinicaltables.nlm.nih.gov/api/icd9cm_dx/v3/search"
PROC_BASE = "https://clinicaltables.nlm.nih.gov/api/icd9cm_sg/v3/search"
COND_BASE = "https://clinicaltables.nlm.nih.gov/api/conditions/v3/search"

# Tunables
PAGE = 500            # API max
SLEEP = 0.15          # polite pause between requests
OUT = "icd9.rich.json"

# We partition by code prefix to cover the whole table without hitting per-query result caps.
DX_PREFIXES = [str(i) for i in range(10)] + ["V", "E"]
PROC_PREFIXES = [str(i) for i in range(10)]  # 00–99

def api_get(url, params):
    q = f"{url}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(q) as r:
        return json.loads(r.read().decode("utf-8"))

def harvest_table(base_url, prefixes, kind):
    """
    Fetch all rows from a ClinicalTables API by iterating prefixes and paginating.
    Returns dict(code -> {"code","kind","name","short"})
    """
    out = {}
    for pfx in prefixes:
        # Use 'terms' to anchor by prefix; request long_name + short_name
        # Fields: cf=code, df=code_dotted,long_name; ef=short_name for abbreviated
        offset = 0
        total_seen = 0
        while True:
            params = {
                "terms": pfx,
                "count": PAGE,
                "offset": offset,
                "df": "code_dotted,long_name",
                "ef": "short_name",
                "cf": "code"
            }
            js = api_get(base_url, params)
            # Response: [total, codes[], ef-hash or null, display-rows[], (optional code system array)]
            total = js[0]
            codes = js[1]
            extras = js[2] or {}
            display_rows = js[3]
            shorts = extras.get("short_name", [])
            # Merge rows
            for i, c in enumerate(codes):
                disp = display_rows[i] if i < len(display_rows) else []
                dotted = disp[0] if disp else c  # df first field is code_dotted
                long_name = disp[1].strip() if len(disp) > 1 else ""
                short_name = (shorts[i].strip() if i < len(shorts) and shorts[i] else "")
                code = dotted or c
                # Only keep rows that truly match prefix at code start
                if not code.upper().startswith(pfx.upper()):
                    continue
                # Prefer longer “long_name” strings (these are better than CMS shorts)
                out[code] = {
                    "code": code,
                    "kind": kind,
                    "name": " ".join(long_name.split()),
                    "short": " ".join(short_name.split()) if short_name else ""
                }
            got = len(codes)
            total_seen += got
            if got == 0 or offset + got >= total:
                break
            offset += got
            time.sleep(SLEEP)
        time.sleep(SLEEP)
    return out

def enrich_with_conditions(records):
    """
    Add human synonyms from ClinicalTables “conditions” dataset.
    We’ll page through common alphabetical prefixes to keep it simple.
    For each hit where term_icd9_code matches a code we hold, append:
      - consumer_name
      - primary_name
      - term_icd9_text (often longer wording)
      - synonyms[] (if present)
    """
    prefixes = list("abcdefghijklmnopqrstuvwxyz") + [str(i) for i in range(10)]
    for pfx in prefixes:
        offset = 0
        while True:
            params = {
                "terms": pfx,
                "count": PAGE,
                "offset": offset,
                # Return ICD9 code & text, plus synonyms & canonical names
                "ef": "term_icd9_code,term_icd9_text,synonyms,primary_name,consumer_name",
                "df": "consumer_name",
                "cf": "key_id",
            }
            js = api_get(COND_BASE, params)
            total = js[0]
            keys = js[1]
            ef = js[2] or {}
            icd9_codes = ef.get("term_icd9_code", [])
            icd9_texts = ef.get("term_icd9_text", [])
            syns = ef.get("synonyms", [])
            prims = ef.get("primary_name", [])
            cons = ef.get("consumer_name", [])
            for i, _ in enumerate(keys):
                code = (icd9_codes[i] or "").strip()
                if not code:
                    continue
                # ClinicalTables uses dotted codes; align
                if code in records:
                    rec = records[code]
                    # prime synonyms
                    rec.setdefault("syn", [])
                    # Prefer human-friendly names as synonyms too
                    cand = [
                        (prims[i] or "").strip(),
                        (cons[i] or "").strip(),
                        (icd9_texts[i] or "").strip()
                    ]
                    for s in cand:
                        if s and s.lower() != rec["name"].lower():
                            rec["syn"].append(s)
                    # array of synonyms (may be list or string)
                    s = syns[i]
                    if isinstance(s, list):
                        for t in s:
                            t = (t or "").strip()
                            if t:
                                rec["syn"].append(t)
                    elif isinstance(s, str):
                        t = s.strip()
                        if t:
                            rec["syn"].append(t)
                    # de-dupe & trim
                    if rec["syn"]:
                        seen = set()
                        uniq = []
                        for t in rec["syn"]:
                            k = t.lower()
                            if k not in seen:
                                seen.add(k); uniq.append(t)
                        rec["syn"] = uniq
            got = len(keys)
            if got == 0 or offset + got >= total:
                break
            offset += got
            time.sleep(SLEEP)
        time.sleep(SLEEP)
    return records

def main():
    # 1) Harvest dx + procedures with long titles
    dx = harvest_table(DX_BASE, DX_PREFIXES, "dx")
    proc = harvest_table(PROC_BASE, PROC_PREFIXES, "proc")
    all_rec = {**dx, **proc}

    # 2) Enrich with consumer names & synonyms where available
    all_rec = enrich_with_conditions(all_rec)

    # 3) Sort numerically, then V/E
    def sort_key(c):
        code = c["code"]
        if code[0].isdigit():
            parts = code.split(".")
            base = int(parts[0])
            frac = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else -1
            return (0, base, frac, code)
        return (1, code[0], code)
    rows = sorted(all_rec.values(), key=sort_key)

    # 4) Compact JSON
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))

    # basic sanity: psych codes present?
    have = {r["code"] for r in rows}
    sample = {"296.20", "300.00", "295.30"}
    missing = [s for s in sample if s not in have]
    sys.stderr.write(f"Wrote {OUT}  records={len(rows)}  missing_psych={missing}\n")

if __name__ == "__main__":
    main()
