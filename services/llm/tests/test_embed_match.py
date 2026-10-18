import math
import os
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg import sql

from app.embeddings import get_embedder
from app.main import app
from app.matching import (
    MatchingUnavailable,
    PgVehicleRepository,
    VehicleRow,
    get_vehicle_repo,
    score_row,
)
from app.schemas import MatchResponse, VehicleRequirementIn

DB_URL = os.getenv("TEST_DATABASE_URL", "postgres://purplemine:purplemine@localhost:5433/purplemine")


@pytest.fixture
def client(fake_embedder):
    app.dependency_overrides[get_embedder] = lambda: fake_embedder
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------- /embed (페이크) ----------
def test_embed_shape_and_kind(client, fake_embedder):
    r = client.post("/embed", json={"texts": ["a b", "제네시스 G90"], "kind": "passage"})
    assert r.status_code == 200
    body = r.json()
    assert body["model"] == "fake-embedder" and body["dimension"] == 384
    assert len(body["embeddings"]) == 2 and all(len(e) == 384 for e in body["embeddings"])
    assert fake_embedder.calls[-1][1] == "passage"


@pytest.mark.parametrize(
    "payload",
    [
        {"texts": [], "kind": "query"},
        {"texts": [""], "kind": "query"},
        {"texts": ["ok", "   "], "kind": "query"},
        {"texts": ["x"] * 65, "kind": "query"},
        {"texts": ["x"], "kind": "other"},
        {"kind": "query"},
    ],
)
def test_embed_validation(client, payload):
    assert client.post("/embed", json=payload).status_code == 422


def test_embed_64_ok(client):
    assert client.post("/embed", json={"texts": ["x"] * 64, "kind": "query"}).status_code == 200


def test_embed_failure_is_503(client):
    class Boom:
        model, dimension = "m", 384

        def embed(self, *_):
            raise OSError("no network")

    app.dependency_overrides[get_embedder] = lambda: Boom()
    assert client.post("/embed", json={"texts": ["x"], "kind": "query"}).status_code == 503


# ---------- /embed (실제 로컬 e5 모델, 로드 불가하면 skip) ----------
@pytest.fixture(scope="module")
def real_embedder():
    from app.embeddings import build_embedder, load_embedding_settings

    e = build_embedder(load_embedding_settings())
    try:
        e.embed(["warmup"], "query")
    except Exception as ex:  # 네트워크/캐시 없음
        pytest.skip(f"local model unavailable: {type(ex).__name__}")
    return e


def test_real_model_dim_norm_semantics(real_embedder):
    vecs = real_embedder.embed(["고급 세단 제네시스", "검은색 고급 승용차", "빨간 소방 트럭"], "passage")
    assert real_embedder.dimension == 384 and all(len(v) == 384 for v in vecs)
    for v in vecs:
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, abs_tol=1e-4)
    dot = lambda a, b: sum(x * y for x, y in zip(a, b))
    assert dot(vecs[0], vecs[1]) > dot(vecs[0], vecs[2])
    q = real_embedder.embed(["고급 세단 제네시스"], "query")[0]
    assert q != vecs[0]  # query:/passage: 접두어가 다르므로 벡터가 달라야 한다


# ---------- 점수 규칙 (DB 없음) ----------
def _req(**kw):
    base = {"vehicleType": "고급 세단", "usage": "CHASE", "damageExpected": False, "quantity": 1}
    return VehicleRequirementIn.model_validate({**base, **kw})


def test_score_rules():
    v = VehicleRow("id1", "SEDAN", "제네시스", "G90", 2022, "검정", 0.9)
    hit = score_row(_req(categoryHint="SEDAN", brandModelHint="제네시스 G90"), v)
    miss = score_row(_req(categoryHint="SUV"), v)
    assert hit.score > miss.score
    assert 0 <= miss.score <= 100 and "분류 SEDAN 일치" in hit.reason and "차명" in hit.reason
    assert "불일치" in miss.reason
    low = score_row(_req(categoryHint="SEDAN"), VehicleRow("i", "SEDAN", "a", "b", 2020, None, 0.2))
    assert low.score == 20


# ---------- /match + 실제 pgvector (임시 스키마, 운영 테이블 미접촉) ----------
@pytest.fixture(scope="module")
def schema():
    try:
        conn = psycopg.connect(DB_URL, connect_timeout=3, autocommit=True)
    except psycopg.Error:
        pytest.skip("local DB unavailable")
    name = f"llm_test_{uuid.uuid4().hex[:8]}"
    conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    conn.execute(
        sql.SQL(
            "CREATE TABLE {}.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "
            "category varchar(10), brand varchar(50), model varchar(100), year smallint, "
            "color varchar(30), damage_allowed boolean DEFAULT false, status varchar(12) DEFAULT 'AVAILABLE', "
            "embedding vector(384))"
        ).format(sql.Identifier(name))
    )
    yield name, conn
    conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))
    conn.close()


@pytest.fixture
def seeded(schema, fake_embedder):
    name, conn = schema
    conn.execute(sql.SQL("TRUNCATE {}.vehicles").format(sql.Identifier(name)))
    rows = [
        ("SEDAN", "제네시스", "G90", 2022, "검정", True, "AVAILABLE", "제네시스 G90 고급 세단 검정"),
        ("SEDAN", "현대", "쏘나타", 2021, "흰색", False, "AVAILABLE", "현대 쏘나타 중형 세단 흰색"),
        ("SUV", "기아", "쏘렌토", 2023, "회색", True, "AVAILABLE", "기아 쏘렌토 SUV 회색"),
        ("SEDAN", "제네시스", "G80", 2020, "검정", True, "MAINTENANCE", "제네시스 G80 고급 세단 검정"),
        ("SEDAN", "기아", "K9", 2019, "검정", True, "AVAILABLE", None),  # 임베딩 없음
    ]
    ids = {}
    for cat, br, mo, yr, col, dmg, st, text in rows:
        emb = None
        if text:
            v = fake_embedder.embed([text], "passage")[0]
            emb = "[" + ",".join(map(str, v)) + "]"
        rid = conn.execute(
            sql.SQL(
                "INSERT INTO {}.vehicles (category,brand,model,year,color,damage_allowed,status,embedding) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s::vector) RETURNING id::text"
            ).format(sql.Identifier(name)),
            (cat, br, mo, yr, col, dmg, st, emb),
        ).fetchone()[0]
        ids[mo] = rid
    return name, ids


@pytest.fixture
def db_client(client, seeded):
    name, ids = seeded
    repo = PgVehicleRepository(DB_URL, schema=name)
    import app.main as m

    app.dependency_overrides[m._repo_dep] = lambda: repo
    return client, ids


def _body(**req):
    base = {"vehicleType": "고급 세단", "categoryHint": "SEDAN", "brandModelHint": "제네시스 G90",
            "usage": "CHASE", "damageExpected": False, "quantity": 1, "sourceQuote": None}
    return {"requirement": {**base, **req}, "topK": 5}


def test_match_ranks_and_filters(db_client):
    client, ids = db_client
    r = client.post("/match", json=_body(sourceQuote="검은색 제네시스 G90이 대기한다"))
    assert r.status_code == 200
    data = MatchResponse.model_validate(r.json())
    got = [c.vehicle_id for c in data.candidates]
    assert got[0] == ids["G90"]
    assert ids["G80"] not in got and ids["K9"] not in got  # MAINTENANCE / 임베딩 없음 제외
    assert all(0 <= c.score <= 100 for c in data.candidates)
    scores = [c.score for c in data.candidates]
    assert scores == sorted(scores, reverse=True)
    assert "분류 SEDAN 일치" in data.candidates[0].reason
    # 분류 일치가 부족하면 완화되어 SUV 도 후보에 포함 (점수는 더 낮음)
    assert ids["쏘렌토"] in got
    assert data.candidates[-1].vehicle_id == ids["쏘렌토"]


def test_match_damage_filter(db_client):
    client, ids = db_client
    got = [c["vehicleId"] for c in client.post("/match", json=_body(damageExpected=True)).json()["candidates"]]
    assert ids["쏘나타"] not in got and ids["G90"] in got


def test_match_no_result_and_topk(db_client):
    client, ids = db_client
    r = client.post("/match", json={**_body(), "topK": 1})
    assert len(r.json()["candidates"]) == 1
    assert client.post("/match", json={**_body(), "topK": 0}).status_code == 422


def test_match_empty_table(schema, client):
    name, conn = schema
    conn.execute(sql.SQL("TRUNCATE {}.vehicles").format(sql.Identifier(name)))
    import app.main as m

    app.dependency_overrides[m._repo_dep] = lambda: PgVehicleRepository(DB_URL, schema=name)
    assert client.post("/match", json=_body()).json()["candidates"] == []


def test_repo_is_read_only(schema):
    name, _ = schema
    repo = PgVehicleRepository(DB_URL, schema=name)
    with repo._connect() as c:
        assert c.execute("SHOW transaction_read_only").fetchone()[0] == "on"
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            c.execute(sql.SQL("DELETE FROM {}.vehicles").format(sql.Identifier(name)))


def test_match_db_down_is_503(client):
    import app.main as m

    bad = PgVehicleRepository("postgres://x:y@127.0.0.1:1/none")
    app.dependency_overrides[m._repo_dep] = lambda: bad
    assert client.post("/match", json=_body()).status_code == 503


def test_match_without_database_url(client, monkeypatch):
    import app.matching as mt

    monkeypatch.setattr(mt, "_repo", None)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(MatchingUnavailable):
        get_vehicle_repo()
    assert client.post("/match", json=_body()).status_code == 503
