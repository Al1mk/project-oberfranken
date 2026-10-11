import hashlib
import json
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse
from . import config as c

KEYS = "id title city topic record_type discovery_category language status qa_tier retrieved_at temporal answer_policy origin retrieval_enabled trust_level source_record_ids matrix_refs source_urls metadata content enrichment practical_details freshness_note scope_note research_limits keywords_text display embedding_text embedding_input".split()
ENUMS = {"city":c.CITIES,"topic":c.TOPICS,"record_type":("fact","place","guide","activity","service","sight","restaurant","sports-club"),"discovery_category":("none","sports","sights","restaurants"),"language":("de",),"status":("verified","source_backed","limited"),"qa_tier":("A","B","C"),"temporal":("static","changing"),"answer_policy":("normal","verify_live_before_answering"),"origin":("codex","friend","merged"),"trust_level":("high","medium","mixed")}
def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"

def normalize(text):
    text = unicodedata.normalize("NFC",text.replace("\r\n","\n").replace("\r","\n"))
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()

def localized(value):
    return isinstance(value,dict) and set(value)=={"de","en"} and all(isinstance(x,str) and x.strip() for x in value.values())

def validate_record(r):
    name = r.get("id", "unknown") if isinstance(r,dict) else "unknown"
    def fail(field):
        raise ValueError(f"record {name}: invalid {field}")
    if not isinstance(r,dict) or list(r)!=KEYS: fail("keys (closed ordered schema)")
    for field in "id title content keywords_text embedding_text embedding_input".split():
        if not isinstance(r[field],str) or not r[field].strip(): fail(field)
    for field in "enrichment practical_details freshness_note scope_note research_limits".split():
        if not isinstance(r[field],str): fail(field)
    for field, values in ENUMS.items():
        if r[field] not in values: fail(field)
    if r["retrieval_enabled"] is not True: fail("retrieval_enabled")
    try:
        if date.fromisoformat(r["retrieved_at"]).isoformat()!=r["retrieved_at"]: fail("retrieved_at")
    except (ValueError,TypeError): fail("retrieved_at")
    for field in ("source_record_ids","matrix_refs","source_urls"):
        values = r[field]
        if not isinstance(values,list) or any(not isinstance(x,str) or (field!="matrix_refs" and not x.strip()) for x in values): fail(field)
        if field!="matrix_refs" and not values: fail(field)
    if any(urlparse(x).scheme not in ("http","https") or not urlparse(x).netloc for x in r["source_urls"]) or not any(urlparse(x).scheme=="https" for x in r["source_urls"]): fail("source_urls HTTP/HTTPS with at least one HTTPS")
    if not isinstance(r["metadata"],dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in r["metadata"].items()): fail("metadata")
    d=r["display"]
    if d is not None:
        if not isinstance(d,dict) or set(d)!={"title","summary","whyNotable","details"} or not all(localized(d[k]) for k in ("title","summary","whyNotable")): fail("display")
        details=d["details"]
        shapes={"restaurant":("cuisine","signatureDish","recommendedOrder","whyOrderIt"),"sight":("whyVisit","keyHighlight","significance"),"sports-club":("sport","achievement","participationType","homeVenue")}
        if r["record_type"] not in shapes or not isinstance(details,dict) or set(details)!=set(shapes[r["record_type"]]): fail("display.details")
        if r["record_type"]=="sports-club":
            if not localized(details["sport"]) or (details["achievement"] is not None and not localized(details["achievement"])) or details["participationType"] not in ("spectator","participant","both") or not isinstance(details["homeVenue"],str) or not details["homeVenue"].strip(): fail("display.details")
        elif not all(localized(x) for x in details.values()): fail("display.details")
    expected=normalize(f"city: {r['city']}\ntopic: {r['topic']}\n\n{r['embedding_text']}")
    if r["embedding_input"]!=expected: fail("embedding_input normalization/reconstruction")
    return r

def load_records(path=c.SOURCE, *, release=True):
    path=Path(path)
    rows=[]
    for number,line in enumerate(path.read_text(encoding="utf-8").splitlines(),1):
        try: rows.append(validate_record(json.loads(line)))
        except (ValueError,TypeError) as exc: raise ValueError(f"{path}:{number}: {exc}") from exc
    for field in ("id","embedding_input"):
        if len({r[field] for r in rows})!=len(rows): raise ValueError(f"duplicate {field}")
    if release:
        manifest=c.release_manifest(path.parent/"manifest.json")
        if digest(path)!=c.JSONL_SHA256: raise ValueError("JSONL release hash mismatch; restore reviewed v3.2 data")
        if len(rows)!=manifest["record_count"] or Counter(r["city"] for r in rows)!=manifest["city_counts"] or Counter(r["status"] for r in rows)!=manifest["status_counts"] or sum(r["display"] is not None for r in rows)!=manifest["display_count"]: raise ValueError("release record counts differ")
    return rows

SCALARS = "title city topic record_type discovery_category language status qa_tier temporal answer_policy origin retrieval_enabled trust_level retrieved_at".split()
def metadata(r):
    m={k:r[k] for k in SCALARS}; m["record_id"]=r["id"]
    m.update(chunk_index=0,chunk_count=1,span_start=0,span_end=len(r["embedding_input"]))
    for k in ("source_urls","source_record_ids","matrix_refs"):
        m[k+"_json"]=json.dumps(r[k],ensure_ascii=False,separators=(",",":"))
    return m
