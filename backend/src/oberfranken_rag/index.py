import hashlib
import importlib.metadata
import json
import os
import multiprocessing
import platform
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from . import config as c
from .records import canonical, digest, metadata
from .embeddings import validate_vectors
from .chunking import build_chunks,validate_chunks

def now(): return datetime.now(timezone.utc).isoformat()
def atomic_json(path,value):
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    with tmp.open("x",encoding="utf-8") as f:
        f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp,path)

def gold_digest(path=c.GOLD):
    path=Path(path); actual=digest(path)
    if path.with_suffix(".sha256").read_text()!=actual+"  gold_queries.json\n": raise ValueError("gold queries are not frozen or have changed")
    return actual

def identity(token_limit):
    return {"jsonl_sha256":c.JSONL_SHA256,"model_id":c.MODEL_ID,"model_revision":c.MODEL_REVISION,"document_prefix":c.DOCUMENT_PREFIX,"query_prefix":c.QUERY_PREFIX,"normalized":True,"dimension":c.DIMENSION,"token_limit":token_limit,"policy":c.POLICY,"collection":c.COLLECTION,"metric":"cosine"}

def client(path):
    import chromadb
    return chromadb.PersistentClient(path=str(path))

def collection(path):
    return client(path).get_collection(c.COLLECTION,embedding_function=None)

def verify(col,records,chunks=None):
    got=col.get(include=["documents","metadatas","embeddings"])
    actual=[{"id":rid,"document":doc,"metadata":m} for rid,doc,m in zip(got["ids"],got["documents"],got["metadatas"])]
    validate_chunks(actual,records)
    if col.count()!=len(actual): raise ValueError("index count mismatch")
    if chunks is not None and sorted(actual,key=lambda x:x["id"])!=sorted(chunks,key=lambda x:x["id"]): raise ValueError("index chunk/document/metadata mismatch")
    validate_vectors(got["embeddings"],len(actual))
    configuration=col.configuration
    if configuration["hnsw"]["space"]!="cosine": raise ValueError("index metric mismatch")

def _stage_process(path,records,chunks,vectors,smoke_vector,manifest,pipe,create):
    """Public Chroma clients have no close: process exit closes all handles."""
    try:
        if create:
            db=client(path)
            col=db.create_collection(c.COLLECTION,embedding_function=None,configuration={"hnsw":{"space":"cosine"}})
            col.add(ids=[x["id"] for x in chunks],documents=[x["document"] for x in chunks],metadatas=[x["metadata"] for x in chunks],embeddings=vectors)
        else: col=collection(path)
        verify(col,records,chunks)
        ids=col.query(query_embeddings=smoke_vector,n_results=3)["ids"][0]
        if create:
            manifest={**manifest,"smoke_query":{"question":records[0]["embedding_input"],"expected_ids":ids,"result_ids":ids}}
            atomic_json(Path(path)/"index_manifest.json",manifest)
        elif ids!=manifest["smoke_query"]["result_ids"]: raise ValueError("staging smoke reopen mismatch")
        pipe.send((True,manifest))
    except Exception as exc: pipe.send((False,f"{type(exc).__name__}: {exc}"))
    finally: pipe.close()

def stage_process(path,records,chunks,vectors,smoke_vector,manifest,create):
    context=multiprocessing.get_context("spawn")
    reader,writer=context.Pipe(duplex=False)
    process=context.Process(target=_stage_process,args=(str(path),records,chunks,vectors,smoke_vector,manifest,writer,create))
    process.start(); writer.close()
    try: ok,result=reader.recv()
    except EOFError: ok,result=False,"staging process terminated without validation"
    finally: reader.close(); process.join()
    if not ok or process.exitcode!=0: raise ValueError(result)
    return result

def build_index(records,encoder,source,storage=c.STORAGE,gold=c.GOLD):
    storage=Path(storage); frozen=gold_digest(gold)
    c.release_manifest(Path(source).parent/"manifest.json")
    if digest(source)!=c.JSONL_SHA256 or len(records)!=c.RELEASE_COUNT: raise ValueError("build requires all frozen release records")
    if storage.is_symlink() or (storage/"indexes").is_symlink() or (storage/"staging").is_symlink(): raise ValueError("unsafe storage symlink")
    chunks=build_chunks(records,encoder); validate_chunks(chunks,records)
    _,counts=encoder.preflight([x["document"] for x in chunks],ids=[x["id"] for x in chunks])
    ident=identity(encoder.token_limit); index_id=hashlib.sha256(canonical(ident).encode()).hexdigest()[:16]
    final=storage/"indexes"/index_id
    if final.is_symlink(): raise ValueError("unsafe immutable index symlink")
    versions={n:importlib.metadata.version(n) for n in ("chromadb","sentence-transformers","transformers","torch")}
    versions["python"]=platform.python_version()
    common={**ident,"schema_version":2,"complete":True,"index_id":index_id,"parent_count":len(records),"record_count":len(records),"collection_count":len(chunks),"vector_count":len(chunks),"metadata_schema_version":2,"gold_sha256":frozen,"record_ids_sha256":hashlib.sha256(canonical([r["id"] for r in records]).encode()).hexdigest(),"chunk_ids_sha256":hashlib.sha256(canonical([x["id"] for x in chunks]).encode()).hexdigest(),"copy_manifest_sha256":digest(Path(source).parent/"manifest.json"),"versions":versions,"device":"cpu","model_cache":getattr(encoder,"cache","test encoder"),"model_cache_resolution":getattr(encoder,"model_cache_resolution","fake encoder"),"token_counts":counts}
    smoke=records[0]["embedding_input"]
    vector=validate_vectors(encoder.encode([smoke],query=True),1).tolist()
    if final.exists():
        manifest=json.loads((final/"index_manifest.json").read_text())
        descriptive={"model_cache","model_cache_resolution"}
        if any(manifest.get(k)!=v for k,v in common.items() if k not in descriptive): raise ValueError("existing immutable index manifest mismatch")
        col=collection(final); verify(col,records,chunks)
        actual=col.query(query_embeddings=vector,n_results=3)["ids"][0]
        if actual!=manifest["smoke_query"]["result_ids"]: raise ValueError("smoke query restart mismatch")
    else:
        stage=storage/"staging"/(index_id+"-"+uuid.uuid4().hex); stage.mkdir(parents=True)
        vectors=validate_vectors(encoder.encode([x["document"] for x in chunks],ids=[x["id"] for x in chunks]),len(chunks))
        manifest=stage_process(stage,records,chunks,vectors.tolist(),vector,{**common,"created_at":now()},True)
        stage_process(stage,records,chunks,None,vector,manifest,False)
        final.parent.mkdir(parents=True,exist_ok=True); os.rename(stage,final)
    atomic_json(storage/"current.json",{"schema_version":1,"index_id":index_id,"relative_path":"indexes/"+index_id,"manifest_sha256":digest(final/"index_manifest.json"),"activated_at":now()})
    return manifest

def open_index(storage=c.STORAGE,gold=c.GOLD,records=None,source=c.SOURCE):
    if Path(storage).is_symlink(): raise ValueError("unsafe storage symlink")
    storage=Path(storage).resolve()
    if (storage/"current.json").is_symlink(): raise ValueError("unsafe pointer symlink")
    pointer=json.loads((storage/"current.json").read_text())
    if set(pointer)!={"schema_version","index_id","relative_path","manifest_sha256","activated_at"} or pointer["schema_version"]!=1: raise ValueError("invalid current pointer")
    index_id=pointer["index_id"]
    if not isinstance(index_id,str) or not re.fullmatch("[0-9a-f]{16}",index_id) or pointer["relative_path"]!="indexes/"+index_id: raise ValueError("unsafe current pointer path")
    path=storage/"indexes"/index_id
    if (storage/"indexes").is_symlink() or path.is_symlink() or path.resolve().parent!=storage/"indexes": raise ValueError("unsafe index symlink/path")
    mp=path/"index_manifest.json"
    if mp.is_symlink() or digest(mp)!=pointer["manifest_sha256"]: raise ValueError("stale pointer/manifest digest mismatch; build-index required")
    manifest=json.loads(mp.read_text())
    expected_keys=set(identity(512))|set("schema_version complete index_id parent_count record_count collection_count vector_count metadata_schema_version gold_sha256 record_ids_sha256 chunk_ids_sha256 copy_manifest_sha256 versions device model_cache model_cache_resolution token_counts created_at smoke_query".split())
    if set(manifest)!=expected_keys or manifest["schema_version"]!=2 or manifest["metadata_schema_version"]!=2 or manifest["complete"] is not True: raise ValueError("incompatible manifest schema")
    if type(manifest["token_limit"]) is not int or manifest["token_limit"]!=512: raise ValueError("incompatible token limit")
    c.release_manifest(Path(source).parent/"manifest.json")
    if manifest["parent_count"]!=c.RELEASE_COUNT or manifest["record_count"]!=c.RELEASE_COUNT or type(manifest["vector_count"]) is not int or manifest["vector_count"]<c.RELEASE_COUNT or manifest["collection_count"]!=manifest["vector_count"] or len(manifest["token_counts"])!=manifest["vector_count"]: raise ValueError("incompatible manifest counts")
    if manifest["copy_manifest_sha256"]!=digest(Path(source).parent/"manifest.json"): raise ValueError("copy manifest digest changed")
    if digest(source)!=c.JSONL_SHA256: raise ValueError("source release digest changed")
    if manifest["normalized"] is not True or manifest["device"]!="cpu" or any(type(x) is not int or not 0<x<=512 for x in manifest["token_counts"]): raise ValueError("incompatible embedding manifest")
    if set(manifest["versions"])!={"chromadb","sentence-transformers","transformers","torch","python"}: raise ValueError("incompatible manifest versions")
    if hashlib.sha256(canonical(identity(manifest.get("token_limit"))).encode()).hexdigest()[:16]!=index_id: raise ValueError("index identity mismatch")
    for k,v in identity(manifest.get("token_limit")).items():
        if manifest.get(k)!=v: raise ValueError(f"incompatible index {k}; build-index required")
    if not manifest.get("complete") or manifest.get("index_id")!=index_id or manifest.get("gold_sha256")!=gold_digest(gold): raise ValueError("incomplete or incompatible manifest")
    for name,version in manifest["versions"].items():
        actual=platform.python_version() if name=="python" else importlib.metadata.version(name)
        if actual!=version: raise ValueError(f"index dependency version changed: {name}; build-index required")
    col=collection(path)
    if col.count()!=manifest["vector_count"]: raise ValueError("manifest collection count mismatch")
    if records:
        verify(col,records)
        if manifest["record_ids_sha256"]!=hashlib.sha256(canonical([r["id"] for r in records]).encode()).hexdigest(): raise ValueError("parent ID digest mismatch")
        got=col.get(include=["metadatas"])
        ordered=sorted(zip(got["ids"],got["metadatas"]),key=lambda x:([r["id"] for r in records].index(x[1]["record_id"]),x[1]["chunk_index"]))
        if manifest["chunk_ids_sha256"]!=hashlib.sha256(canonical([x[0] for x in ordered]).encode()).hexdigest(): raise ValueError("chunk ID digest mismatch")
    return col,manifest
