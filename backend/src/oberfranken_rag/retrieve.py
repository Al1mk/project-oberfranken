import json
from dataclasses import dataclass, asdict
from . import config as c
from .embeddings import validate_vectors

def validate_query(question,city=None,topic=None,top_k=5):
    if not isinstance(question,str) or not question.strip() or len(question.strip())>2000: raise ValueError("question must contain 1–2000 characters")
    if city is not None and city not in c.CITIES: raise ValueError("unknown city")
    if topic is not None and topic not in c.TOPICS: raise ValueError("unknown topic")
    if type(top_k) is not int or not 1<=top_k<=20: raise ValueError("top_k must be an integer from 1 through 20")
    return question.strip()

def make_filter(city=None,topic=None):
    parts=[]
    if city: parts.append({"city":city} if city=="oberfranken" else {"city":{"$in":[city,"oberfranken"]}})
    if topic: parts.append({"topic":topic})
    return {"$and":parts} if len(parts)>1 else parts[0] if parts else None

@dataclass(frozen=True)
class RetrievalResult:
    id:str; title:str; city:str; topic:str; status:str; answer_policy:str; trust_level:str
    source_urls:list; source_record_ids:list; matrix_refs:list; retrieved_at:str; temporal:str
    document:str; distance:float; rank:int
    freshness_note:str=""; scope_note:str=""; research_limits:str=""
    chunk_id:str=""; chunk_document:str=""; chunk_index:int=0; chunk_count:int=1; span_start:int=0; span_end:int=0
    def to_dict(self): return asdict(self)

def retrieve(collection,encoder,question,city=None,topic=None,top_k=5,records=None):
    question=validate_query(question,city,topic,top_k)
    if not records: raise ValueError("frozen parent records are required for retrieval")
    where=make_filter(city,topic); kwargs={"where":where} if where else {}
    count=len(collection.get(include=[],**kwargs)["ids"])
    if count==0: return []
    vectors=validate_vectors(encoder.encode([question],query=True),1)
    result=collection.query(query_embeddings=vectors.tolist(),n_results=count,include=["documents","metadatas","distances"],**kwargs)
    rows=sorted(zip(result["ids"][0],result["metadatas"][0],result["documents"][0],result["distances"][0]),key=lambda x:(x[3],x[0]))
    output=[]; source={r["id"]:r for r in records}; seen=set()
    for chunk_id,m,document,distance in rows:
        rid=m["record_id"]
        if rid in seen: continue
        if rid not in source: raise ValueError(f"unknown frozen parent {rid}")
        seen.add(rid); body=source[rid]
        output.append(RetrievalResult(rid,m["title"],m["city"],m["topic"],m["status"],m["answer_policy"],m["trust_level"],json.loads(m["source_urls_json"]),json.loads(m["source_record_ids_json"]),json.loads(m["matrix_refs_json"]),m["retrieved_at"],m["temporal"],body["embedding_input"],float(distance),len(output)+1,*(body.get(k,"") for k in ("freshness_note","scope_note","research_limits")),chunk_id,document,m["chunk_index"],m["chunk_count"],m["span_start"],m["span_end"]))
        if len(output)==top_k: break
    return output
