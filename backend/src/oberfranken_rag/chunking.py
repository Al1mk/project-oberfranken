"""Deterministic lossless source-character spans, measured with the pinned tokenizer."""
from .records import metadata

def context_header(record):
    return f"city: {record['city']}\ntopic: {record['topic']}\ntitle: {record['title']}\n\n"

def build_chunks(records,encoder):
    chunks=[]
    for record in records:
        text=record["embedding_input"]; spans=[]; header=""
        if encoder.token_count(text)<=encoder.token_limit:
            spans=[(0,len(text))]
        else:
            header=context_header(record)
            if encoder.token_count(header)>=encoder.token_limit: raise ValueError(f"{record['id']}: context header leaves no chunk token capacity")
            start=0
            while start<len(text):
                # Binary search proposes a safe endpoint; every emitted span is
                # independently measured, so tokenization non-monotonicity cannot truncate.
                low=start+1; high=len(text); end=start
                while low<=high:
                    mid=(low+high)//2
                    if encoder.token_count(header+text[start:mid])<=encoder.token_limit:
                        end=mid; low=mid+1
                    else: high=mid-1
                if end==start: raise ValueError(f"{record['id']}: zero-length safe chunk")
                if end<len(text):
                    paragraph=text.rfind("\n\n",start,end)
                    whitespace=max((i+1 for i in range(start,end) if text[i].isspace()),default=start)
                    preferred=paragraph+2 if paragraph>=start else whitespace
                    if preferred>start and encoder.token_count(header+text[start:preferred])<=encoder.token_limit: end=preferred
                if end<=start or encoder.token_count(header+text[start:end])>encoder.token_limit: raise ValueError(f"{record['id']}: unsafe chunk endpoint")
                spans.append((start,end)); start=end
        if "".join(text[a:b] for a,b in spans)!=text: raise ValueError(f"{record['id']}: lossless span reconstruction failed")
        for i,(start,end) in enumerate(spans):
            m={**metadata(record),"chunk_index":i,"chunk_count":len(spans),"span_start":start,"span_end":end}
            chunks.append({"id":record["id"] if len(spans)==1 else f"{record['id']}::c{i:03d}","document":header+text[start:end],"metadata":m})
    encoder.preflight([x["document"] for x in chunks],ids=[x["id"] for x in chunks])
    return chunks

def validate_chunks(chunks,records):
    parents={r["id"]:r for r in records}; groups={rid:[] for rid in parents}
    if len({x["id"] for x in chunks})!=len(chunks): raise ValueError("duplicate chunk ID")
    for chunk in chunks:
        m=chunk["metadata"]; rid=m.get("record_id")
        if rid not in parents: raise ValueError("unknown chunk parent")
        groups[rid].append(chunk)
    for rid,group in groups.items():
        if not group: raise ValueError(f"missing parent {rid}")
        record=parents[rid]; text=record["embedding_input"]
        group.sort(key=lambda x:x["metadata"]["chunk_index"]); previous=0
        for i,chunk in enumerate(group):
            m=chunk["metadata"]
            if any(type(m.get(k)) is not int for k in ("chunk_index","chunk_count","span_start","span_end")): raise ValueError("chunk offsets must be integers")
            a,b=m["span_start"],m["span_end"]
            expected={**metadata(record),"chunk_index":i,"chunk_count":len(group),"span_start":a,"span_end":b}
            expected_id=rid if len(group)==1 else f"{rid}::c{i:03d}"
            doc=(context_header(record) if len(group)>1 else "")+text[a:b]
            if m!=expected or chunk["id"]!=expected_id or a!=previous or not a<b<=len(text) or chunk["document"]!=doc: raise ValueError(f"invalid chunk/source metadata {chunk['id']}")
            previous=b
        if previous!=len(text): raise ValueError(f"incomplete source spans {rid}")
    return chunks
