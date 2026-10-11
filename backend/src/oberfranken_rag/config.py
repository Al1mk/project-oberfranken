from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT.parent / "data" / "v3.2"
SOURCE = DATA / "Oberfranken_Knowledge_Base_Merged_v3.2.jsonl"
STORAGE = ROOT / "storage"
GOLD = ROOT / "evaluation" / "gold_queries.json"
MANIFEST_SHA256 = "af181c67d8053af71f1790e2aaa958ec12064d46b39ae31088a648953ca6bec8"

def release_manifest(path=DATA / "manifest.json"):
    payload = Path(path).read_bytes()
    if hashlib.sha256(payload).hexdigest() != MANIFEST_SHA256:
        raise ValueError("release manifest digest mismatch")
    return json.loads(payload)

RELEASE = release_manifest()
RELEASE_COUNT = RELEASE["record_count"]
JSONL_SHA256 = RELEASE["copied"][SOURCE.name]["sha256"]
MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
DIMENSION = 384
DOCUMENT_PREFIX = "passage: "
QUERY_PREFIX = "query: "
COLLECTION = "oberfranken_kb_v32"
TOPICS = ("local-traditions", "regional-food", "cultural-places", "local-history", "newcomer-essentials", "activities-fun")
CITIES = ("bamberg", "bayreuth", "oberfranken")
POLICY = "lossless-character-spans-v2"
