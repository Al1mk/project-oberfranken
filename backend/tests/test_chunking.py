import copy
import json
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.records import load_records
from oberfranken_rag.chunking import build_chunks,validate_chunks
from oberfranken_rag.index import atomic_json,digest,open_index
from oberfranken_rag.retrieve import retrieve

class CharacterEncoder:
    token_limit=512
    def token_count(self,text,query=False): return len(text)+9
    def preflight(self,texts,query=False,ids=None):
        counts=[self.token_count(x) for x in texts]
        if any(x>self.token_limit for x in counts): raise ValueError("over-limit chunk")
        return texts,counts

def test_lossless_spans_and_stable_ids():
    row=load_records()[0]; row=copy.deepcopy(row)
    row["embedding_input"]="header\n\n"+"one two three four five "*70
    chunks=build_chunks([row],CharacterEncoder())
    assert len(chunks)>1
    assert chunks==build_chunks([row],CharacterEncoder())
    assert [x["id"] for x in chunks]==[f"{row['id']}::c{i:03d}" for i in range(len(chunks))]
    assert "".join(row["embedding_input"][x["metadata"]["span_start"]:x["metadata"]["span_end"]] for x in chunks)==row["embedding_input"]
    validate_chunks(chunks,[row])
    broken=copy.deepcopy(chunks); broken[1]["metadata"]["span_start"]+=1
    with pytest.raises(ValueError,match="invalid chunk"):validate_chunks(broken,[row])
    with pytest.raises(ValueError,match="missing parent"):validate_chunks([], [row])

def test_oversized_header():
    row=copy.deepcopy(load_records()[0]); row["title"]="x"*600; row["embedding_input"]="y"*700
    with pytest.raises(ValueError,match="context header"):build_chunks([row],CharacterEncoder())

def test_unsplit_unchanged():
    row=copy.deepcopy(load_records()[0]); row["embedding_input"]="small"
    chunk=build_chunks([row],CharacterEncoder())[0]
    assert chunk["id"]==row["id"] and chunk["document"]=="small"

def test_pinned_tokenizer_all_parents_lossless():
    from tokenizers import Tokenizer
    path=c.ROOT/"model_cache"/"models--intfloat--multilingual-e5-small"/"snapshots"/c.MODEL_REVISION/"tokenizer.json"
    if not path.exists(): pytest.skip("local pinned tokenizer cache unavailable")
    tokenizer=Tokenizer.from_file(str(path)); tokenizer.no_truncation()
    class Encoder(CharacterEncoder):
        def token_count(self,text,query=False):return len(tokenizer.encode(c.DOCUMENT_PREFIX+text).ids)
    rows=load_records(); chunks=build_chunks(rows,Encoder()); validate_chunks(chunks,rows)
    assert len({x["metadata"]["record_id"] for x in chunks})==c.RELEASE_COUNT
    assert len(chunks)>c.RELEASE_COUNT
    assert {x["metadata"]["record_id"] for x in chunks if x["metadata"]["chunk_count"]>1}=={"BY-SIGHT-01","BY-NEW-01"}
    assert max(Encoder().token_count(x["document"]) for x in chunks)<=512

def test_dedup_best_chunk_full_parent():
    row=load_records()[0]; other=load_records()[1]
    chunks=build_chunks([row,other],CharacterEncoder())
    class Collection:
        def get(self,**kw): return {"ids":[x["id"] for x in chunks]}
        def query(self,**kw):
            assert kw["n_results"]==len(chunks)
            return {"ids":[[x["id"] for x in chunks]],"documents":[[x["document"] for x in chunks]],"metadatas":[[x["metadata"] for x in chunks]],"distances":[list(range(len(chunks)))]}
    from test_backend import FakeEncoder
    results=retrieve(Collection(),FakeEncoder(),"question",records=[row,other])
    assert len(results)==2 and len({x.id for x in results})==2
    assert results[0].document==row["embedding_input"]
    assert results[0].chunk_document==chunks[0]["document"]
    assert results[0].span_start==0

@pytest.mark.parametrize("field,value",[("schema_version",99),("metadata_schema_version",1),("complete",1),("record_count",248),("vector_count",248),("copy_manifest_sha256","0"*64)])
def test_rehashed_incompatible_manifest_rejected_before_chroma(tmp_path,field,value,monkeypatch):
    from test_backend import FakeEncoder
    from oberfranken_rag import index
    rows=load_records(); index.build_index(rows,FakeEncoder(),c.SOURCE,tmp_path)
    pointer=json.loads((tmp_path/"current.json").read_text()); mp=tmp_path/pointer["relative_path"]/"index_manifest.json"
    manifest=json.loads(mp.read_text()); manifest[field]=value; atomic_json(mp,manifest)
    pointer["manifest_sha256"]=digest(mp); atomic_json(tmp_path/"current.json",pointer)
    monkeypatch.setattr(index,"collection",lambda *a: (_ for _ in ()).throw(AssertionError("Chroma must not open")))
    with pytest.raises(ValueError):open_index(tmp_path,records=rows)
