"""Citation provenance through the real service and frozen records; provider is offline."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import pytest
from oberfranken_rag.chat.api import load_catalog
from oberfranken_rag.chat.service import ChatService
from chat_fakes import FakeProvider, FakeRetriever, contract_ok, real_records, record, result

TOURISM = "https://en.bamberg.info/gastronomie/rauchbierbrauerei_schlenkerla-259"
MENU = "https://www.schlenkerla.de/schlenkerla/karte/speisen.html"

def service_for(rec, catalog=None):
    provider = FakeProvider()
    service = ChatService({rec["id"]: rec}, FakeRetriever([result(rec)]), provider, catalog or {})
    return service, provider

def schlenkerla():
    rows = real_records()
    if rows is None:
        pytest.skip("frozen release unavailable")
    return deepcopy(next(r for r in rows if r["id"] == "BA-REST-01"))

@pytest.mark.parametrize("language", ["en", "de"])
def test_historical_schlenkerla_answer_cites_the_page_supporting_its_excerpt(language):
    rec = schlenkerla()
    service, provider = service_for(rec, load_catalog())
    question = "What is Schlenkerla known for in Bamberg?" if language == "en" else "Wofür ist Schlenkerla in Bamberg bekannt?"
    reply = service.answer(question, "bamberg", language)
    contract_ok(reply)
    assert len(provider.calls) == 1
    source = reply["sources"][0]
    assert source["sourceUrl"] == TOURISM
    assert source["sourceName"] == "Bamberg Tourismus"
    assert source["retrievedAt"] == rec["retrieved_at"]
    assert source["recordStatus"] == "verified"
    assert source["sourceUrl"] in rec["source_urls"]

@pytest.mark.parametrize("question", ["Is Schlenkerla open today?", "Hat Schlenkerla heute geöffnet?"])
def test_live_menu_pointer_names_the_actual_operator_domain_without_a_provider_call(question):
    rec = schlenkerla()
    service, provider = service_for(rec, load_catalog())
    reply = service.answer(question, "bamberg", "de")
    contract_ok(reply)
    assert provider.calls == []
    assert reply["sources"][0]["sourceUrl"] == MENU
    assert reply["sources"][0]["sourceName"] == "schlenkerla.de"

def test_cross_domain_official_link_does_not_inherit_the_primary_publishers_name():
    rec = record(metadata={"source_name": "Bamberg Tourismus", "official_url": MENU})
    service, _ = service_for(rec)
    reply = service.answer("What is Schlenkerla known for?", "bamberg", "en")
    assert reply["sources"][0]["sourceUrl"] == MENU
    assert reply["sources"][0]["sourceName"] == "schlenkerla.de"

def test_primary_publisher_name_is_preserved_when_its_url_is_used():
    rec = record()
    service, _ = service_for(rec)
    source = service.answer("What is Schlenkerla known for?", "bamberg", "en")["sources"][0]
    assert source["sourceUrl"] == rec["source_urls"][0]
    assert source["sourceName"] == "Bamberg Tourismus"

def test_reviewed_citation_never_invents_a_url_missing_from_the_parent():
    rec = schlenkerla()
    rec["source_urls"].remove(TOURISM)
    service, provider = service_for(rec, load_catalog())
    reply = service.answer("What is Schlenkerla known for?", "bamberg", "en")
    assert provider.calls == []  # no historical generation without its audited source
    assert reply["text"].startswith("Source pointer:")
    source = reply["sources"][0]
    assert source["sourceUrl"] in rec["source_urls"]
    assert source["sourceUrl"] != TOURISM
    assert source["sourceName"] == "schlenkerla.de"

def test_offline_smoke_checker_accepts_the_reviewed_static_excerpt_citation():
    rec = schlenkerla()
    service, _ = service_for(rec, load_catalog())
    reply = service.answer("What is Schlenkerla known for?", "bamberg", "en")
    spec = importlib.util.spec_from_file_location("live_smoke", Path(__file__).parents[1] / "scripts/live_smoke.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.check_reply(reply, {rec["id"]: rec}) == []
