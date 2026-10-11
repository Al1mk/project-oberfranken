import copy
import json
from pathlib import Path
import numpy as np
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.records import load_records, validate_record, metadata
from oberfranken_rag.embeddings import E5Encoder, validate_vectors
from oberfranken_rag.index import atomic_json, open_index, gold_digest
from oberfranken_rag.retrieve import retrieve

SOURCE=c.SOURCE if c.SOURCE.exists() else Path("/Users/alimk/Documents/university/Coburg/Project and trend managment/full-project/data/v3.1/Oberfranken_Knowledge_Base_Merged_v3.1.jsonl")

@pytest.fixture
def rows():
    if not SOURCE.exists(): pytest.skip("release fixture unavailable; supply copied v3.1 data")
    return load_records(SOURCE)

def test_release(rows):
    assert len(rows)==c.RELEASE_COUNT
    assert sum(r["status"]=="limited" for r in rows)==8
    assert len({r["embedding_input"] for r in rows})==c.RELEASE_COUNT

@pytest.mark.parametrize("field,value",[("retrieval_enabled",1),("source_urls",["http://example.com"]),("metadata",{"a":1}),("embedding_input","wrong"),("display",{}),("retrieved_at","2026-99-99")])
def test_schema_errors(rows,field,value):
    row=copy.deepcopy(rows[0]); row[field]=value
    with pytest.raises(ValueError,match=field): validate_record(row)

def test_extra_field(rows):
    row=copy.deepcopy(rows[0]); row["extra"]=True
    with pytest.raises(ValueError,match="keys"): validate_record(row)

def test_metadata(rows):
    m=metadata(rows[0])
    assert json.loads(m["source_urls_json"])==rows[0]["source_urls"]
    assert all(type(x) in (str,int,float,bool) for x in m.values())

def test_legacy_http_preserved(rows):
    row=next(r for r in rows if r["id"]=="BT-CULT-010")
    assert "http://www.gartenkunst-museum.de/" in row["source_urls"]
    bad=copy.deepcopy(row); bad["source_urls"]=["ftp://example.com"]
    with pytest.raises(ValueError,match="source_urls"): validate_record(bad)

def test_limitation_context_roundtrip(tmp_path,rows):
    import chromadb
    row=next(r for r in rows if r["status"]=="limited")
    col=chromadb.PersistentClient(path=str(tmp_path)).create_collection(c.COLLECTION,embedding_function=None,configuration={"hnsw":{"space":"cosine"}})
    encoder=FakeEncoder()
    col.add(ids=[row["id"]],documents=[row["embedding_input"]],metadatas=[metadata(row)],embeddings=encoder.encode([row["embedding_input"]]).tolist())
    result=retrieve(col,encoder,"context",records=rows)[0]
    assert result.status=="limited"
    assert result.freshness_note==row["freshness_note"]
    assert result.scope_note==row["scope_note"]
    assert result.research_limits==row["research_limits"]

class NeverEncoder:
    def encode(self,*args,**kwargs): raise AssertionError("encoder must not run")

def test_zero_matches_real_chroma(tmp_path,rows):
    import chromadb
    col=chromadb.PersistentClient(path=str(tmp_path)).create_collection(c.COLLECTION,embedding_function=None,configuration={"hnsw":{"space":"cosine"}})
    r=rows[0]; vector=np.zeros(c.DIMENSION); vector[0]=1
    col.add(ids=[r["id"]],documents=[r["embedding_input"]],metadatas=[metadata(r)],embeddings=[vector.tolist()])
    assert retrieve(col,NeverEncoder(),"history","oberfranken","local-history",records=rows)==[]

def test_pointer_rejects_traversal(tmp_path):
    atomic_json(tmp_path/"current.json",{"schema_version":1,"index_id":"a"*16,"relative_path":"../escape","manifest_sha256":"bad","activated_at":"today"})
    with pytest.raises(ValueError,match="unsafe"): open_index(tmp_path)

def test_vector_errors():
    with pytest.raises(ValueError): validate_vectors(np.zeros((1,384)),1)
    with pytest.raises(ValueError): validate_vectors(np.ones((1,3)),1)

def test_frozen_gold():
    assert gold_digest()=="aa56f448b960db8307ebf824b9a90806eb35bdc78e0b2aca4ff02706684a3298"

def test_gold_coverage(rows):
    cases=json.loads(c.GOLD.read_text()); by_id={r["id"]:r for r in rows}
    assert len(cases)==26
    for city in ("bamberg","bayreuth"):
        for topic in c.TOPICS:
            assert {q["language"] for q in cases if q["city"]==city and q["topic"]==topic}=={"de","en"}
    for q in cases:
        assert q["expected_ids"] and all(rid in by_id for rid in q["expected_ids"])
        assert all(by_id[rid]["city"] in (q["city"],"oberfranken") and by_id[rid]["topic"]==q["topic"] for rid in q["expected_ids"])

class Tokenizer:
    model_max_length=512
    def __call__(self,text,**kwargs):
        assert kwargs=={"add_special_tokens":True,"truncation":False}
        return {"input_ids":list(range(len(text)))}

class FakeModel:
    tokenizer=Tokenizer()
    def tokenize(self,texts):
        return {"attention_mask":np.ones((1,len(texts[0]))) }

def test_preflight_prefix_and_overflow():
    encoder=object.__new__(E5Encoder); encoder.model=FakeModel(); encoder.token_limit=512
    assert encoder.preflight(["hello"])[0]==["passage: hello"]
    assert encoder.preflight(["hello"],query=True)[0]==["query: hello"]
    with pytest.raises(ValueError,match="long-id: 609 tokens"):
        encoder.preflight(["x"*600],ids=["long-id"])

class FakeEncoder:
    token_limit=512
    cache="deterministic fake encoder"
    def token_count(self,text,query=False): return 10
    def preflight(self,texts,query=False,ids=None): return texts,[10]*len(texts)
    def encode(self,texts,query=False,ids=None):
        import hashlib
        vectors=[]
        for text in texts:
            raw=hashlib.shake_256(text.encode()).digest(384)
            v=np.frombuffer(raw,dtype=np.uint8).astype(np.float32)-128
            vectors.append(v/np.linalg.norm(v))
        return np.asarray(vectors)

def test_build_reopen_idempotence_and_failure(tmp_path,rows,monkeypatch):
    from oberfranken_rag.index import build_index
    encoder=FakeEncoder()
    manifest=build_index(rows,encoder,SOURCE,tmp_path)
    pointer=json.loads((tmp_path/"current.json").read_text())
    col,reopened=open_index(tmp_path,records=rows)
    assert reopened==manifest
    assert len(col.get(include=[])["ids"])==c.RELEASE_COUNT
    results=retrieve(col,encoder,"hello","bamberg","regional-food",20,rows)
    assert len(results)==20 and all(r.city in ("bamberg","oberfranken") and r.topic=="regional-food" for r in results)
    assert len({r.id for r in results})==20
    assert build_index(rows,encoder,SOURCE,tmp_path)==manifest
    stable=(tmp_path/"current.json").read_bytes()
    from oberfranken_rag import index
    monkeypatch.setattr(index,"verify",lambda *args: (_ for _ in ()).throw(ValueError("interrupted validation")))
    with pytest.raises(ValueError,match="interrupted"): build_index(rows,encoder,SOURCE,tmp_path)
    assert (tmp_path/"current.json").read_bytes()==stable
    mp=tmp_path/pointer["relative_path"]/"index_manifest.json"
    modified=json.loads(mp.read_text()); modified["complete"]=False
    atomic_json(mp,modified)
    with pytest.raises(ValueError,match="stale"): open_index(tmp_path)

def test_failed_staging_preserves_pointer(tmp_path,rows,monkeypatch):
    from oberfranken_rag import index
    atomic_json(tmp_path/"current.json",{"previous":"usable"})
    before=(tmp_path/"current.json").read_bytes()
    monkeypatch.setattr(index,"stage_process",lambda *a: (_ for _ in ()).throw(ValueError("interrupted insert")))
    with pytest.raises(ValueError,match="interrupted"): index.build_index(rows,FakeEncoder(),SOURCE,tmp_path)
    assert (tmp_path/"current.json").read_bytes()==before
