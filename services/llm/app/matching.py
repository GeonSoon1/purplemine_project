"""요구사항 -> 보유 차량 후보 매칭 (pgvector 코사인 거리, DB 읽기 전용)."""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Protocol

import psycopg
from psycopg import sql

from .schemas import MatchCandidate, VehicleRequirementIn


@dataclass(frozen=True)
class VehicleRow:
    id: str
    category: str
    brand: str
    model: str
    year: int
    color: str | None
    similarity: float  # 코사인 유사도 (1 - cosine distance)


class VehicleRepository(Protocol):
    def search(
        self, query_vec: list[float], *, category: str | None, damage_only: bool, limit: int
    ) -> list[VehicleRow]:
        """status='AVAILABLE' AND embedding IS NOT NULL 인 차량을 코사인 거리순으로.
        category 가 있으면 그 분류만, damage_only 면 damage_allowed=true 만."""


class MatchingUnavailable(RuntimeError):
    pass


class PgVehicleRepository:
    """읽기 전용. 연결마다 read_only 트랜잭션으로 열어 쓰기를 DB 수준에서 막는다."""

    def __init__(self, dsn: str, schema: str | None = None, table: str = "vehicles"):
        self._dsn = dsn
        self._table = sql.Identifier(schema, table) if schema else sql.Identifier(table)

    def _connect(self) -> psycopg.Connection:
        conn = psycopg.connect(self._dsn, connect_timeout=5)
        conn.read_only = True
        return conn

    def search(self, query_vec, *, category, damage_only, limit):
        conds = [sql.SQL("status = 'AVAILABLE'"), sql.SQL("embedding IS NOT NULL")]
        params: list = [_vec_literal(query_vec)]
        if damage_only:
            conds.append(sql.SQL("damage_allowed = true"))
        if category:
            conds.append(sql.SQL("category = %s"))
            params.append(category)
        q = sql.SQL(
            "SELECT id::text, category, brand, model, year, color, "
            "1 - (embedding <=> %s::vector) AS sim FROM {t} WHERE {w} "
            "ORDER BY embedding <=> %s::vector LIMIT %s"
        ).format(t=self._table, w=sql.SQL(" AND ").join(conds))
        params = [params[0], *params[1:], params[0], limit]
        try:
            with self._connect() as conn:
                rows = conn.execute(q, params).fetchall()
        except psycopg.Error as e:
            raise MatchingUnavailable(f"vehicle search failed: {type(e).__name__}") from e
        return [VehicleRow(r[0], r[1], r[2], r[3], r[4], r[5], float(r[6])) for r in rows]


def _vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


_repo: VehicleRepository | None = None
_guard = threading.Lock()


def get_vehicle_repo() -> VehicleRepository:
    """FastAPI 의존성. 테스트에서는 dependency_overrides 로 교체."""
    global _repo
    with _guard:
        if _repo is None:
            dsn = os.getenv("DATABASE_URL", "").strip()
            if not dsn:
                raise MatchingUnavailable("DATABASE_URL is not set")
            _repo = PgVehicleRepository(dsn)
        return _repo


# ---- 점수 규칙 ----
SIM_FLOOR = 0.75   # 실측(e5-small): 무관한 차종도 0.77~0.80, 잘 맞는 쌍은 0.84~0.92 -> 0.75 미만은 0점
SIM_SPAN = 0.20    # 0.75~0.95 -> 0~70점
W_SIM, W_CATEGORY, W_NAME = 70, 20, 10


def query_text(r: VehicleRequirementIn) -> str:
    parts = [r.vehicle_type, r.brand_model_hint, r.source_quote]
    return " ".join(p.strip() for p in parts if p and p.strip())


def _norm(s: str) -> str:
    return "".join(s.lower().split())


def _name_match(r: VehicleRequirementIn, v: VehicleRow) -> bool:
    hint = _norm(r.brand_model_hint or "")
    if not hint:
        return False
    return _norm(f"{v.brand}{v.model}") in hint or hint in _norm(f"{v.brand}{v.model}") or (
        len(_norm(v.model)) >= 2 and _norm(v.model) in hint
    )


def score_row(r: VehicleRequirementIn, v: VehicleRow) -> MatchCandidate:
    sim_pts = round(max(0.0, min(1.0, (v.similarity - SIM_FLOOR) / SIM_SPAN)) * W_SIM)
    reasons: list[str] = []
    cat_hint = r.category_hint.value if r.category_hint else None
    if cat_hint is None:
        cat_pts = W_CATEGORY // 2  # 힌트 없으면 중립
    elif v.category == cat_hint:
        cat_pts = W_CATEGORY
        reasons.append(f"분류 {v.category} 일치")
    else:
        cat_pts = 0
        reasons.append(f"분류 불일치({v.category})")
    name_ok = _name_match(r, v)
    name_pts = W_NAME if name_ok else 0
    if name_ok:
        reasons.append(f"차명 '{r.brand_model_hint}' 일치")
    if r.damage_expected:
        reasons.append("파손 촬영 가능 차량")
    reasons.append(f"의미 유사도 {round(max(0.0, v.similarity) * 100)}%")
    desc = " ".join(str(x) for x in (v.brand, v.model, f"{v.year}년식", v.color) if x)
    score = max(0, min(100, sim_pts + cat_pts + name_pts))
    return MatchCandidate(vehicle_id=v.id, score=score, reason=f"{desc}: " + ", ".join(reasons) + ".")


def match(
    r: VehicleRequirementIn, top_k: int, query_vec: list[float], repo: VehicleRepository
) -> list[MatchCandidate]:
    cat = r.category_hint.value if r.category_hint else None
    rows = repo.search(query_vec, category=cat, damage_only=r.damage_expected, limit=top_k)
    if cat and len(rows) < top_k:  # 분류 일치가 부족하면 필터를 풀어 채운다 (점수에서 불리)
        seen = {x.id for x in rows}
        extra = repo.search(
            query_vec, category=None, damage_only=r.damage_expected, limit=top_k + len(rows)
        )
        rows += [x for x in extra if x.id not in seen][: top_k - len(rows)]
    cands = [score_row(r, v) for v in rows]
    cands.sort(key=lambda c: c.score, reverse=True)
    return cands[:top_k]
