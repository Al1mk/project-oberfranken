import argparse
import json
import sys
from datetime import datetime,timezone
from pathlib import Path
from . import config as c
from .records import load_records, canonical
from .embeddings import E5Encoder
from .index import build_index,open_index,gold_digest
from .retrieve import retrieve

def evaluate(col,encoder,records,gold,output):
    frozen=gold_digest(gold); cases=json.loads(Path(gold).read_text()); results=[]
    for case in cases:
        rows=retrieve(col,encoder,case["question"],case.get("city"),case.get("topic"),5,records)
        ids=[r.id for r in rows]; ranks=[i+1 for i,rid in enumerate(ids) if rid in case["expected_ids"]]
        violations=sum((case.get("city") and r.city not in ([case["city"],"oberfranken"] if case["city"]!="oberfranken" else ["oberfranken"])) or (case.get("topic") and r.topic!=case["topic"]) for r in rows)
        results.append({**case,"returned_ids":ids,"rank":min(ranks) if ranks else None,"filter_violations":violations})
    metrics={f"hit_at_{k}":sum(r["rank"] is not None and r["rank"]<=k for r in results)/len(results) for k in (1,3,5)}
    metrics["mrr"]=sum(1/r["rank"] if r["rank"] else 0 for r in results)/len(results)
    metrics["filter_violations"]=sum(r["filter_violations"] for r in results)
    metrics["per_language_hit_at_5"]={lang:sum(r["rank"] is not None for r in results if r["language"]==lang)/sum(r["language"]==lang for r in results) for lang in ("de","en")}
    passed=metrics["hit_at_3"]>=.8 and metrics["hit_at_5"]>=.9 and metrics["filter_violations"]==0 and all(x>=.85 for x in metrics["per_language_hit_at_5"].values())
    report={"gold_sha256":frozen,"metrics":metrics,"passed":passed,"cases":results}
    output=Path(output); output.mkdir(parents=True,exist_ok=True)
    path=output/(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+"-"+frozen[:12]+".json")
    with path.open("x",encoding="utf-8") as f: f.write(canonical(report))
    return report

def main(argv=None):
    p=argparse.ArgumentParser(); p.add_argument("--source",type=Path,default=c.SOURCE); p.add_argument("--storage",type=Path,default=c.STORAGE); p.add_argument("--gold",type=Path,default=c.GOLD); p.add_argument("--model-cache",type=Path)
    sub=p.add_subparsers(dest="command",required=True)
    for name in ("validate-data","build-index","inspect-index","evaluate"): sub.add_parser(name)
    q=sub.add_parser("query"); q.add_argument("question"); q.add_argument("--city"); q.add_argument("--topic"); q.add_argument("--top-k",type=int,default=5)
    args=p.parse_args(argv)
    try:
        records=load_records(args.source)
        if args.command=="validate-data": result={"record_count":len(records),"jsonl_sha256":c.JSONL_SHA256}
        elif args.command=="build-index": result=build_index(records,E5Encoder(args.model_cache),args.source,args.storage,args.gold)
        else:
            col,manifest=open_index(args.storage,args.gold,records,args.source)
            if args.command=="inspect-index": result=manifest
            else:
                encoder=E5Encoder(args.model_cache)
                if encoder.token_limit!=manifest["token_limit"]: raise ValueError("model token limit differs from index")
                if args.command=="query": result=[r.to_dict() for r in retrieve(col,encoder,args.question,args.city,args.topic,args.top_k,records)]
                else:
                    result=evaluate(col,encoder,records,args.gold,c.ROOT/"evaluation"/"runs")
                    print(canonical(result),end=""); return 0 if result["passed"] else 1
        print(canonical(result),end=""); return 0
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}",file=sys.stderr); return 1

if __name__=="__main__": raise SystemExit(main())
