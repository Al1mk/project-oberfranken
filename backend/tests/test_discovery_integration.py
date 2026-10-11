"""Real frozen E5/Chroma routing; fake provider proves routing, not prose."""
import json
import re
import pytest
from oberfranken_rag.chat.api import build_service
from oberfranken_rag.chat.settings import Settings
from chat_fakes import contract_ok

BA_RESTAURANTS={'BA-REST-01','BA-REST-02','BA-REST-03'}
BY_RESTAURANTS={'BY-REST-01','BY-REST-02'}
BA_FOOTBALL={'BA-SPORT-02','BA-SPORT-03'}
BY_FOOTBALL={'BY-SPORT-01'}
BA_OVERVIEW={'BA-HIST-02','BA-RESEARCH-002'}
BY_OVERVIEW={'BY-HIST-03','BY-SIGHT-01','BY-TRAD-01'}

class RecordingProvider:
    def __init__(self): self.calls=[]
    def complete(self,system,user,deadline=None):
        self.calls.append((system,user))
        ids=re.findall(r'<evidence id="([^"]+)"',user)
        return json.dumps({'supported':True,'answer':'A documented fact.','record_ids':ids[:1]})

@pytest.fixture(scope='module')
def real_service():
    provider=RecordingProvider()
    return build_service(Settings(),provider),provider

CASES=[
 ('can you suggest a restaurant?','bamberg','English',BA_RESTAURANTS),
 ('can you suggest a restaurant?','bayreuth','English',BY_RESTAURANTS),
 ('Can you suggest a restaurant in Bamberg?','bamberg','English',BA_RESTAURANTS),
 ('Can you suggest a restaurant in Bayreuth?','bayreuth','English',BY_RESTAURANTS),
 ('i want to eat in a restourant?','bamberg','English',BA_RESTAURANTS),
 ('i want to eat in a restourant?','bayreuth','English',BY_RESTAURANTS),
 ('give me a good restourant in baberg?','bamberg','English',BA_RESTAURANTS),
 ('where can i eat in bamberg when im hungr?','bamberg','English',BA_RESTAURANTS),
 ('where can i eat in bayreuth when im hungr?','bayreuth','English',BY_RESTAURANTS),
 ('ich möchte essen wo kann hingehen?','bayreuth','German',BY_RESTAURANTS),
 ('im a student whee can i eat?','bamberg','English',BA_RESTAURANTS),
 ('im a student where can i eat?','bayreuth','English',{'BT-ACT-CAMPUS-FOOD'}),
 ('kann man in bamberg fußball spielen?','bamberg','German',BA_FOOTBALL),
 ('Which football clubs are documented in Bayreuth?','bayreuth','English',BY_FOOTBALL),
 ('was ist bayreuth?','bayreuth','German',BY_OVERVIEW),
 ('whats bayreuth?','bayreuth','English',BY_OVERVIEW),
 ('What is Bamberg?','bamberg','English',BA_OVERVIEW),
 ('What is Bayreuth? Give me a short introduction.','bayreuth','English',BY_OVERVIEW),
 ('Was ist Bamberg? Gib mir eine kurze Einführung.','bamberg','German',BA_OVERVIEW),
]
# Fixed before implementation; no numeric threshold tuning against this set.
HELDOUT=[
 ('Any places to grab a meal in Bamberg?','bamberg','English',BA_RESTAURANTS),
 ('Ich suche ein Lokal zum Essen in Bayreuth.','bayreuth','German',BY_RESTAURANTS),
 ('Where could I get involved in football in Bamberg?','bamberg','English',BA_FOOTBALL),
 ('Welche Fußballvereine gibt es in Bamberg?','bamberg','German',BA_FOOTBALL),
 ('Give me a short introduction to Bayreuth.','bayreuth','English',BY_OVERVIEW),
]

LIVE_CASES=[
 ('Can you suggest a restaurant in Bamberg?', 'bamberg', 'English', BA_RESTAURANTS),
 ('Welche Restaurants kannst du in Bayreuth nennen?', 'bayreuth', 'German', BY_RESTAURANTS),
 ("I'm a student in Bamberg. Where can I eat?", 'bamberg', 'English', BA_RESTAURANTS),
 ("I'm a student in Bayreuth. Where can I eat on campus?", 'bayreuth', 'English', {'BT-ACT-CAMPUS-FOOD'}),
 ('Kann man in Bamberg Fußball spielen?', 'bamberg', 'German', BA_FOOTBALL),
 ('Which football clubs are documented in Bayreuth?', 'bayreuth', 'English', BY_FOOTBALL),
 ('What is Bayreuth? Give me a short introduction.', 'bayreuth', 'English', BY_OVERVIEW),
 ('Was ist Bamberg? Gib mir eine kurze Einführung.', 'bamberg', 'German', BA_OVERVIEW),
]

@pytest.mark.parametrize('ui_language',['de','en'])
@pytest.mark.parametrize('question,city,language,expected',CASES+HELDOUT+LIVE_CASES)
def test_discovery_relevant_static_evidence(real_service,question,city,language,expected,ui_language):
    service,provider=real_service
    provider.calls.clear()
    reply=service.answer(question,city,ui_language)
    contract_ok(reply)
    assert len(provider.calls)==1,(question,reply)
    system,user=provider.calls[0]
    assert f'Write the answer in {language}' in system
    assert f'Question: {question}' in user
    supplied=set(re.findall(r'<evidence id="([^"]+)"',user))
    assert supplied and supplied<=expected,(question,supplied,expected)
    assert len(supplied)<=5
    assert {s['recordId'] for s in reply['sources']}<=expected
    assert reply['kind']=='answer' and not reply['text'].startswith(('Source pointer:','Quellenhinweis:'))
