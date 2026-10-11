"""Real cached E5/Chroma with a recording provider: no network or ledger."""
import copy
import json
import re
import pytest
from oberfranken_rag import config as c
from oberfranken_rag.records import load_records
from oberfranken_rag.index import open_index
from oberfranken_rag.embeddings import E5Encoder
from oberfranken_rag.retrieve import retrieve
from oberfranken_rag.chat.api import load_catalog
from oberfranken_rag.chat.service import ChatService
from chat_fakes import FakeProvider, FakeRetriever, result, model_json, contract_ok

UNIVERSITIES={'BA-NEW-UNIVERSITY','BY-NEW-UNIVERSITY'}

class RecordingProvider:
    def __init__(self): self.calls=[]
    def complete(self,system,user,deadline=None):
        self.calls.append((system,user))
        ids=re.findall(r'<evidence id="([^"]+)"',user)
        return model_json('A documented institutional fact.',ids)

@pytest.fixture(scope='module')
def real_service():
    rows=load_records()
    col,_=open_index(c.STORAGE,records=rows)
    encoder=E5Encoder(c.ROOT/'model_cache')
    provider=RecordingProvider()
    return ChatService({r['id']:r for r in rows},lambda q,city,deadline=None:retrieve(col,encoder,q,city,None,20,rows),provider,load_catalog()),provider

@pytest.mark.parametrize('context',[None,'bamberg','bayreuth'])
@pytest.mark.parametrize('question,language',[
    ('Wo kann man in Oberfranken studieren?','de'),
    ('Where can I study in Oberfranken?','en'),
    ('Which universities are in Upper Franconia?','en'),
    ('1. Where can I study in Oberfranken?','en'),
    (r'1\. Where can I study in Oberfranken?','en'),
    ('2) Where can I study in Oberfranken?','en'),
    ('20. Wo kann man in Oberfranken studieren?','de'),
])
def test_regional_study_supplies_only_two_pilot_universities(real_service,context,question,language):
    service,provider=real_service; provider.calls.clear()
    reply=service.answer(question,context,'en' if language=='de' else 'de')
    contract_ok(reply)
    assert len(provider.calls)==1,(question,reply)
    system,user=provider.calls[0]
    assert set(re.findall(r'<evidence id="([^"]+)"',user))==UNIVERSITIES
    assert f'Question: {question}' in user
    assert 'Write the answer in '+('German' if language=='de' else 'English') in system
    assert {s['recordId'] for s in reply['sources']}==UNIVERSITIES
    assert all(s['recordStatus']=='limited' for s in reply['sources'])
    assert 'pilot' in reply['text'].lower()
    assert 'Hof' not in user and 'Coburg' not in user

@pytest.mark.parametrize('city,rid',[('bamberg','BA-NEW-UNIVERSITY'),('bayreuth','BY-NEW-UNIVERSITY')])
@pytest.mark.parametrize('question',['Where can I study in {city}?','Wo kann man in {city} studieren?'])
def test_city_study_only_its_university(real_service,city,rid,question):
    service,provider=real_service;provider.calls.clear()
    reply=service.answer(question.format(city=city),city,'de')
    assert len(provider.calls)==1,reply
    assert set(re.findall(r'<evidence id="([^"]+)"',provider.calls[0][1]))=={rid}
    assert {s['recordId'] for s in reply['sources']}=={rid}

@pytest.mark.parametrize('question',[
    "What makes Bamberg's Old Town Hall on the Regnitz distinctive?",
    'Was macht die Lage und die Fassaden des Alten Rathauses in Bamberg besonders?',
])
def test_old_town_hall_exact_entity_with_static_tourism_evidence(real_service,question):
    service,provider=real_service;provider.calls.clear()
    reply=service.answer(question,'bamberg','de');contract_ok(reply)
    assert len(provider.calls)==1,reply
    assert set(re.findall(r'<evidence id="([^"]+)"',provider.calls[0][1]))=={'BA-SIGHT-02'}
    assert reply['sources'][0]['sourceUrl']=='https://www.bamberg.info/poi/altes_rathaus-4656'
    assert reply['sources'][0]['sourceName']=='Bamberg Tourismus'
    assert reply['sources'][0]['recordStatus']=='verified'

@pytest.mark.parametrize('question,city',[
    ('Where can I study in Hof?',None),
    ('Where can I study in Coburg?',None),
    ('Where can I study in Bamberg or Bayreuth?',None),
    ('Where can I study in Bayreuth?','bamberg'),
    ('Where can I study engineering in Oberfranken?',None),
    ('Where can I study in Oberfranken and what are the admission deadlines?',None),
    ('1. Where can I study in Oberfranken for 200 euros?',None),
    ('1. Where can I study in Oberfranken in 2027?',None),
    ('1. Where can I study engineering in Oberfranken?',None),
    ('1. Where can I study in Hof?',None),
    ('What are the opening hours of Bamberg Old Town Hall?','bamberg'),
])
def test_unsupported_or_current_details_do_not_reach_provider(real_service,question,city):
    service,provider=real_service;provider.calls.clear()
    reply=service.answer(question,city,'en');contract_ok(reply)
    assert provider.calls==[],reply

def test_study_route_cannot_bypass_distance_guard(real_service):
    real,_=real_service
    rows={i:real.records[i] for i in UNIVERSITIES}
    retriever=FakeRetriever([result(r,.201) for r in rows.values()])
    provider=FakeProvider(model_json('University fact',tuple(rows)))
    reply=ChatService(rows,retriever,provider,{}).answer('Where can I study in Oberfranken?',None,'en')
    assert reply['kind']=='fallback' and not provider.calls

def test_old_town_hall_projection_missing_provenance_fails_closed(real_service):
    real,_=real_service
    rec=copy.deepcopy(real.records['BA-SIGHT-02'])
    rec['source_urls']=['https://en.bamberg.info/poi/altes_rathaus-4656']
    provider=FakeProvider(model_json('Island fact',('BA-SIGHT-02',)))
    reply=ChatService({rec['id']:rec},FakeRetriever([result(rec)]),provider,{}).answer('What makes Bamberg Old Town Hall distinctive?','bamberg','en')
    assert not provider.calls
