import json
import pytest
from oberfranken_rag.records import validate_record
from oberfranken_rag.retrieve import make_filter, validate_query

def test_closed_schema():
    with pytest.raises(ValueError, match="keys"):
        validate_record({"id": "extra"})

@pytest.mark.parametrize("question,city,topic,k", [("",None,None,5),("x","other",None,5),("x",None,"other",5),("x",None,None,True),("x",None,None,21)])
def test_bad_query(question, city, topic, k):
    with pytest.raises(ValueError):
        validate_query(question, city, topic, k)

def test_filters():
    assert make_filter(None, None) is None
    assert make_filter("bamberg", "regional-food") == {"$and": [{"city": {"$in": ["bamberg", "oberfranken"]}}, {"topic": "regional-food"}]}
    assert make_filter("oberfranken", None) == {"city": "oberfranken"}
