"""Offline helpers for the ONE live smoke test. This script never calls the network and never prints the key.

  preflight          shows only booleans and non-secret settings plus the production ledger (it must show 0 calls)
  check REPLY.json   validates one /api/chat reply against the UI contract and the real records, then prints the ledger's last-call record
"""
import json
import re
import sys
from oberfranken_rag import config as c
from oberfranken_rag.chat import policy, settings as S
from oberfranken_rag.records import load_records
from oberfranken_rag.chat.evidence import reviewed_excerpt

def ledger():
    path = S.Settings().ledger_path
    return json.loads(path.read_text()) if path.is_file() else {}

def preflight():
    s = S.load_settings()
    led = ledger()
    print(json.dumps({"key_present": bool(s.api_key), "model": s.model, "endpoint": s.endpoint_tag, "approved_pair": S.endpoint_for(s.model, s.endpoint_tag) is not None,
                      "budget_usd": s.budget_usd, "paid_calls_enabled": s.allow_paid, "ledger_calls": led.get("calls"), "ledger_spent_usd": led.get("spent_usd"),
                      "ledger_pending_usd": led.get("pending_usd")}, indent=1))

def check_reply(reply, records_by_id):
    """Returns a list of problems; an empty list means the contract and the citations are valid."""
    problems = []
    if not isinstance(reply, dict) or set(reply) != {"text", "kind", "isSample", "sources"}: return ["reply fields are not exactly text, kind, isSample, sources"]
    if not isinstance(reply["text"], str) or not reply["text"].strip(): problems.append("empty text")
    if reply["kind"] not in ("answer", "out-of-scope", "fallback"): problems.append("bad kind")
    if reply["isSample"] is not False: problems.append("isSample is not false")
    if not isinstance(reply["sources"], list): return problems + ["sources is not a list"]
    if reply["kind"] == "answer" and not reply["sources"]: problems.append("answer without sources")
    if reply["kind"] != "answer" and reply["sources"]: problems.append("non-answer with sources")
    for src in reply["sources"]:
        if set(src) != {"recordId", "title", "sourceName", "sourceUrl", "topic", "retrievedAt", "recordStatus"}: problems.append("source fields"); continue
        rec = records_by_id.get(src["recordId"])
        if rec is None: problems.append(f"unknown record {src['recordId']}"); continue
        if src["sourceUrl"] not in rec["source_urls"]: problems.append(f"{src['recordId']}: URL is not one of the record's source URLs")
        if src["retrievedAt"] != rec["retrieved_at"] or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", src["retrievedAt"]): problems.append(f"{src['recordId']}: retrieval date differs")
        if src["topic"] != rec["topic"]: problems.append(f"{src['recordId']}: topic differs")
        if src["recordStatus"] != policy.api_status(rec["status"]): problems.append(f"{src['recordId']}: status mapping differs")
        if (rec["answer_policy"] != "normal" or rec["temporal"] != "static") and reviewed_excerpt(rec) is None:
            problems.append(f"{src['recordId']}: a changing record without a reviewed static excerpt was cited as an answer source")
    return problems

def check(path):
    reply = json.loads(open(path, encoding="utf-8").read())
    by_id = {r["id"]: r for r in load_records(c.SOURCE)}
    problems = check_reply(reply, by_id)
    led = ledger()
    print(json.dumps({"kind": reply.get("kind"), "source_ids": [s.get("recordId") for s in reply.get("sources", [])],
                      "source_status": [s.get("recordStatus") for s in reply.get("sources", [])], "answer_chars": len(reply.get("text", "")),
                      "contract_and_citations_valid": not problems, "problems": problems,
                      "ledger": {k: led.get(k) for k in ("calls", "spent_usd", "pending_usd", "prompt_tokens", "completion_tokens", "reasoning_tokens_seen")},
                      "last_call": led.get("last_call")}, indent=1))
    return 0 if not problems else 1

if __name__ == "__main__":
    if sys.argv[1:2] == ["preflight"]: preflight()
    elif sys.argv[1:2] == ["check"] and len(sys.argv) == 3: raise SystemExit(check(sys.argv[2]))
    else: raise SystemExit(__doc__)
