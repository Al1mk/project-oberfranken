"""Discovery regressions: real service and frozen corpus, provider IO isolated."""
from copy import deepcopy
import pytest
from chat_fakes import FakeClock, FakeProvider, FakeRetriever, contract_ok, model_json, real_records, result
from oberfranken_rag.chat import policy
from oberfranken_rag.chat.provider import ProviderError
from oberfranken_rag.chat.service import ChatService

@pytest.fixture(scope="module")
def records():
    rows = real_records()
    assert rows, "Frozen release required for local acceptance"
    return {r['id']: r for r in rows}

def setup(rows, distances=None, clock=None):
    distances = distances or [.12 + i * .002 for i in range(len(rows))]
    retriever = FakeRetriever([result(r, d, i+1) for i,(r,d) in enumerate(zip(rows, distances))])
    provider = FakeProvider(model_json('A documented fact.', [rows[-1]['id']]))
    service = ChatService({r['id']:r for r in rows}, retriever, provider, {}, **({'clock':clock} if clock else {}))
    return service, retriever, provider

@pytest.mark.parametrize('question', ['kann man in bamberg fußball spielen?', 'Fußballvereine in Bamberg?', 'Ich suche ein Lokal zum Essen in Bayreuth.'])
def test_german_question_not_english_because_of_shared_in(question):
    assert policy.reply_language(question, 'en') == 'de'

def test_typo_city_cannot_override_page(records):
    service, retriever, provider = setup([records['BY-REST-01']])
    reply = service.answer('give me a good restourant in baberg?', 'bayreuth', 'en')
    assert reply['kind'] == 'fallback' and 'switch the city' in reply['text']
    assert retriever.calls == provider.calls == []

@pytest.mark.parametrize('question', ['can you suggest a restaurant?', 'Where can I play football?', 'I am a student, where can I eat?'])
def test_missing_city_discovery_is_local(records, question):
    service, retriever, provider = setup([records['BA-REST-01']])
    reply = service.answer(question, None, 'en')
    assert reply['kind'] == 'fallback' and 'Bamberg or Bayreuth' in reply['text']
    assert retriever.calls == provider.calls == []

def test_irrelevant_best_does_not_unlock_weak_relevant(records):
    service, _, provider = setup([records['BA-SPORT-01'], records['BA-REST-01']], [.10,.21])
    reply = service.answer('Can you suggest a restaurant in Bamberg?', 'bamberg', 'en')
    assert provider.calls == [] and reply.reason == 'weak_evidence'
    assert reply['sources'] == []

def test_restaurant_route_excludes_basketball(records):
    service, retriever, provider = setup([records['BA-REST-01'], records['BA-SPORT-01']], [.12,.121])
    provider.content = model_json('A documented fact.', ['BA-REST-01'])
    reply = service.answer('give me a good restourant in baberg?', 'bamberg', 'en')
    contract_ok(reply)
    assert len(provider.calls) == 1, reply
    assert 'BA-SPORT-01' not in provider.calls[0][1]
    assert retriever.calls == [('bamberg Restaurant Wirtshaus Brauereigaststätte Essen','bamberg')]
    assert 'Question: give me a good restourant in baberg?' in provider.calls[0][1]

def test_football_does_not_use_basketball(records):
    service, _, provider = setup([records['BA-SPORT-01']])
    reply = service.answer('kann man in bamberg fußball spielen?', 'bamberg', 'en')
    assert provider.calls == [] and reply['sources'] == []
    assert reply.reason == 'weak_evidence'

@pytest.mark.parametrize('question', ['Where can I play cricket in Bamberg?', 'Can you suggest vegan restaurants in Bamberg?', 'Can you suggest restaurant Nebula in Bamberg?'])
def test_unknown_sport_diet_venue_not_substituted(records, question):
    service, _, provider = setup([records['BA-SPORT-01'],records['BA-REST-01']])
    reply = service.answer(question, 'bamberg', 'en')
    assert provider.calls == [] and reply['sources'] == []

def test_source_title_ui_language_separate_from_answer(records):
    rec = deepcopy(records['BA-SPORT-02'])
    rec['display'] = {'title':{'en':'English club title','de':'Deutscher Vereinsname'}}
    service, _, provider = setup([rec])
    reply = service.answer('kann man in bamberg fußball spielen?', 'bamberg', 'en')
    assert len(provider.calls) == 1, reply
    assert 'German' in provider.calls[0][0]
    assert reply['sources'][0]['title'] == 'English club title'

def test_one_retrieval_forwards_deadline_and_expiry_stops_provider(records):
    clock = FakeClock()
    service, _, provider = setup([records['BA-REST-01']], clock=clock)
    calls = []
    def retrieve(question, city, deadline=None):
        calls.append((question,city,deadline))
        clock.advance(2)
        return [result(records['BA-REST-01'])]
    service.retrieve = retrieve
    with pytest.raises(ProviderError) as exc:
        service.answer('can you suggest a restaurant?', 'bamberg','en',clock()+1)
    assert exc.value.code == 'timeout' and provider.calls == []
    assert calls == [('bamberg Restaurant Wirtshaus Brauereigaststätte Essen','bamberg',1001.0)]

@pytest.mark.parametrize('change',['url','parent'])
def test_projection_parent_and_url_fail_closed(records, change):
    rec = deepcopy(records['BA-REST-02'])
    if change == 'url': rec['source_urls']=['https://example.org/unrelated']
    else: rec['content']='Unreviewed replacement.'
    service, _, provider = setup([rec])
    reply = service.answer('Can you suggest a restaurant?', 'bamberg','en')
    assert provider.calls == []
    if change == 'url': assert reply['sources'] == []

def test_oskar_generic_intro_cites_tourism_not_dish_menu(records):
    service, _, provider = setup([records['BY-REST-01']])
    reply = service.answer('Can you suggest a restaurant in Bayreuth?', 'bayreuth','en')
    assert len(provider.calls) == 1, reply
    assert '3 vom Grill' not in provider.calls[0][1]
    assert reply['sources'][0]['sourceUrl']=='https://www.bayreuth-tourismus.de/restaurants/oskar-das-wirtshaus-am-markt'
    assert reply['sources'][0]['sourceName']=='Bayreuth Tourismus'

@pytest.mark.parametrize('question,kind',[('Hallo','fallback'),('Which medication should I take?','out-of-scope'),('Can you suggest a restaurant in Berlin?','out-of-scope'),('Can you suggest a restaurant in Bayreuth?','fallback')])
def test_existing_prechecks_stop_discovery(records, question,kind):
    service,retriever,provider=setup([records['BA-REST-01']])
    assert service.answer(question,'bamberg','en')['kind']==kind
    assert retriever.calls==provider.calls==[]

def test_missing_city_not_applied_to_unrecognized_factual_question(records):
    service,retriever,_=setup([records['BA-HIST-02']])
    service.answer('What is UNESCO?',None,'en')
    assert len(retriever.calls)==1

def test_oskar_documented_dish_cites_its_own_menu(records):
    service, _, provider = setup([records['BY-REST-01']])
    reply = service.answer('What regional dish is documented for Oskar in Bayreuth?', 'bayreuth', 'en')
    assert '3 vom Grill' in provider.calls[0][1]
    assert reply['sources'][0]['sourceUrl'] == 'https://oskar-bayreuth.de/speisen-getranke'
    assert reply['sources'][0]['sourceName'] == 'Oskar – Das Wirtshaus am Markt'

@pytest.mark.parametrize('question', ['Bitte auf Deutsch: Can you suggest a restaurant?', 'kann man in bamberg fußball spielen?'])
def test_discovery_prompt_preserves_explicit_and_inferred_language(records, question):
    rec = records['BA-SPORT-02'] if 'fußball' in question else records['BA-REST-01']
    service, _, provider = setup([rec])
    service.answer(question, 'bamberg', 'en')
    assert len(provider.calls) == 1
    assert 'Write the answer in German' in provider.calls[0][0]

@pytest.mark.parametrize('question', ['Where can I play tennis and ice hockey in Bayreuth?', 'Where can I play football and cricket in Bamberg?'])
def test_mixed_unsupported_sport_is_not_hidden(records, question):
    rec = records['BY-SPORT-03'] if 'Bayreuth' in question else records['BA-SPORT-02']
    service, _, provider = setup([rec])
    reply = service.answer(question, rec['city'], 'en')
    assert provider.calls == [] and reply['sources'] == []

@pytest.mark.parametrize('question,expected', [
    ('can you suggest a restaurant?', 'restaurant'),
    ('im a student whee can i eat?', 'campus-food'),
    ('Which football clubs exist here?', 'football'),
    ('Which basketball clubs exist here?', 'basketball'),
    ('Which ice hockey clubs exist here?', 'ice-hockey'),
    ('Welche Sportvereine gibt es?', 'sport'),
    ('What is Bayreuth? Give me a short introduction.', 'overview'),
    ('Was ist Bamberg? Gib mir eine kurze Einführung.', 'overview'),
    ('What is Rauchbier?', None),
    ('What regional dish is documented for Oskar?', None),
    ('Which English-language student theatre group can I join?', None),
    ('Why are the Bamberg Baskets notable?', None),
    ('What can I do for fun in Bamberg?', None),
    ('Where can I party in Bamberg?', None),
    ('Tell me about Bayreuth opera.', None),
])
def test_intent_precedence_and_scope(question, expected):
    from oberfranken_rag.chat.discovery import interpret
    route = interpret(question, 'bamberg')
    assert (route.intent if route else None) == expected

def test_eligible_enforces_city_and_restaurant_type(records):
    from oberfranken_rag.chat.discovery import interpret, eligible
    route = interpret('Can you suggest a restaurant?', 'bamberg')
    assert eligible(route, records['BA-REST-02'])
    assert not eligible(route, records['BY-REST-01'])
    changed = dict(records['BA-REST-02'], record_type='activity')
    assert not eligible(route, changed)

def test_all_discovery_projections_verbatim_nonvolatile_and_url_specific(records):
    from oberfranken_rag.chat.evidence import DISCOVERY_EXCERPTS, discovery_excerpt, discovery_citation
    for rid, (parts, url, publisher) in DISCOVERY_EXCERPTS.items():
        rec = records[rid]
        text = discovery_excerpt(rec)
        assert text and not policy.has_volatile(text), rid
        assert discovery_citation(rec) == (url, publisher)
        original = '\n'.join((rec['content'], rec['enrichment']))
        assert all(p in original for p in parts)
        missing_url = deepcopy(rec)
        missing_url['source_urls'].remove(url)
        assert discovery_excerpt(missing_url) is None
        assert discovery_citation(missing_url) is None
        missing_part = dict(rec, content='', enrichment='')
        assert discovery_excerpt(missing_part) is None
        assert discovery_citation(missing_part) is None

def test_unreviewed_bayreuth_basketball_is_pointer_not_season_generation(records):
    service, _, provider = setup([records['BY-SPORT-02']])
    reply = service.answer('Which basketball clubs are documented in Bayreuth?', 'bayreuth', 'en')
    assert provider.calls == [] and reply['text'].startswith('Source pointer:')
    assert [s['recordId'] for s in reply['sources']] == ['BY-SPORT-02']
    assert '2026/27' not in reply['text']

@pytest.mark.parametrize('question,rid', [
    ('Can you suggest the Nebula restaurant in Bamberg?', 'BA-REST-02'),
    ('Wo kann ich im Wirtshaus Nebula in Bamberg essen?', 'BA-REST-02'),
    ('Where can I eat and play cricket in Bamberg?', 'BA-REST-02'),
    ('Which sports clubs offer boxing in Bamberg?', 'BA-SPORT-01'),
    ('Can you suggest a pescatarian restaurant in Bamberg?', 'BA-REST-02'),
])
def test_unrecognized_discovery_constraints_cannot_unlock_generic_evidence(records, question, rid):
    service, _, provider = setup([records[rid]])
    reply = service.answer(question, 'bamberg', 'en')
    assert provider.calls == [], (question, provider.calls)
    assert reply['kind'] == 'fallback' and reply['sources'] == []

@pytest.mark.parametrize('question', [
    'Can you suggest the Nebula restaurant in Bamberg?',
    'Wo kann ich im Wirtshaus Nebula in Bamberg essen?',
    'Where can I eat and play cricket in Bamberg?',
    'Which sports clubs offer boxing in Bamberg?',
    'Can you suggest a pescatarian restaurant in Bamberg?',
])
def test_constrained_question_retained_not_replaced_by_generic_query(question):
    from oberfranken_rag.chat.discovery import interpret
    route = interpret(question, 'bamberg')
    assert route and route.query == question

@pytest.mark.parametrize('question', [
    'What are restaurant opening hours in Bamberg?',
    'Welche Öffnungszeiten haben die Restaurants in Bamberg?',
])
def test_live_restaurant_details_remain_relevant_local_pointer(records, question):
    service, _, provider = setup([records['BA-REST-02'], records['BA-SPORT-01']])
    reply = service.answer(question, 'bamberg', 'en')
    assert provider.calls == []
    assert reply['kind'] == 'answer'
    assert reply['text'].startswith(('Source pointer:', 'Quellenhinweis:'))
    assert [s['recordId'] for s in reply['sources']] == ['BA-REST-02']

@pytest.mark.parametrize('question', [
    'Can you suggest a restaurant for €10 in Bamberg?',
    'Can you suggest a restaurant for 10 in Bamberg?',
])
def test_numeric_or_symbol_discovery_constraint_not_erased(records, question):
    from oberfranken_rag.chat.discovery import interpret
    route = interpret(question, 'bamberg')
    assert route and route.query == question
    service, _, provider = setup([records['BA-REST-02']])
    reply = service.answer(question, 'bamberg', 'en')
    assert provider.calls == [] and reply['sources'] == []

@pytest.mark.parametrize('question', [
    'Restaurant in Bamberg?',
    'Restaurants in Bayreuth?',
    'Student in Bamberg?',
])
@pytest.mark.parametrize('ui_language', ['en', 'de'])
def test_shared_short_question_words_retain_ui_language(question, ui_language):
    assert policy.reply_language(question, ui_language) == ui_language

@pytest.mark.parametrize('question', [
    'Which restaurants are open in Bamberg?',
    'Are restaurants open in Bamberg?',
])
def test_bare_current_open_restaurant_request_is_local_pointer(records, question):
    service, _, provider = setup([records['BA-REST-02']])
    reply = service.answer(question, 'bamberg', 'en')
    assert provider.calls == []
    assert reply['kind'] == 'answer' and reply['text'].startswith('Source pointer:')
    assert [s['recordId'] for s in reply['sources']] == ['BA-REST-02']

def test_historical_opened_is_not_a_current_opening_request(records):
    service, _, provider = setup([records['BA-REST-01']])
    reply = service.answer('Who opened Schlenkerla in Bamberg?', 'bamberg', 'en')
    assert not policy.asks_live_details('Who opened Schlenkerla in Bamberg?')
    assert len(provider.calls) == 1 and reply['kind'] == 'answer'
