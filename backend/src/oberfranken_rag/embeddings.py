import numpy as np
from . import config as c

def validate_vectors(vectors, count):
    a=np.asarray(vectors,dtype=np.float32)
    if a.shape!=(count,c.DIMENSION) or not np.isfinite(a).all() or not np.allclose(np.linalg.norm(a,axis=1),1,atol=1e-4):
        raise ValueError("embeddings must be finite normalized 384-dimensional float32 vectors")
    return a

class E5Encoder:
    def __init__(self, cache=None):
        from sentence_transformers import SentenceTransformer
        self.model=SentenceTransformer(c.MODEL_ID,revision=c.MODEL_REVISION,device="cpu",cache_folder=str(cache) if cache else None)
        if self.model.get_sentence_embedding_dimension()!=c.DIMENSION: raise ValueError("model dimension mismatch")
        limits=[self.model.max_seq_length,self.model.tokenizer.model_max_length]
        self.token_limit=min(int(x) for x in limits if x and 0<x<1000000)
        self.cache=str(cache) if cache else "Hugging Face default cache"
        self.model_cache_resolution=str(self.model[0].auto_model.config._name_or_path)
    def preflight(self,texts,query=False,ids=None):
        prefixed=[(c.QUERY_PREFIX if query else c.DOCUMENT_PREFIX)+x for x in texts]
        counts=[]
        for i,text in enumerate(prefixed):
            count=len(self.model.tokenizer(text,add_special_tokens=True,truncation=False)["input_ids"])
            name=ids[i] if ids else "query" if query else str(i)
            if count>self.token_limit: raise ValueError(f"{name}: {count} tokens exceeds {self.token_limit}; no truncation allowed")
            actual=int(self.model.tokenize([text])["attention_mask"].sum().item())
            if actual!=count: raise ValueError(f"{name}: tokenizer mismatch {count} versus {actual}; truncation refused")
            counts.append(count)
        return prefixed,counts
    def token_count(self,text,query=False):
        prefix=c.QUERY_PREFIX if query else c.DOCUMENT_PREFIX
        return len(self.model.tokenizer(prefix+text,add_special_tokens=True,truncation=False)["input_ids"])
    def encode(self,texts,query=False,ids=None):
        prefixed,_=self.preflight(texts,query,ids)
        return validate_vectors(self.model.encode(prefixed,normalize_embeddings=True,convert_to_numpy=True,show_progress_bar=False),len(texts))
