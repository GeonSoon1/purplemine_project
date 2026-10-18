# 보유 차량 API

## Vehicle 객체
```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "plateNo": "12가 3456",
  "brand": "제네시스",
  "model": "G90",
  "year": 2023,
  "category": "SEDAN",
  "color": "검정",
  "seats": 5,
  "dailyRate": 220000,
  "damageAllowed": true,
  "status": "AVAILABLE",
  "description": "제네시스 G90 2023 검정 대형 세단. 의전/추격 촬영용",
  "createdAt": "2026-10-19T03:21:00.000Z",
  "updatedAt": "2026-10-19T03:21:00.000Z"
}
```
- `description`: 매칭/임베딩에 쓰는 설명. 비우면 서버가 브랜드·모델·연식·색상·분류로 자동 생성한다.
- 임베딩 벡터는 응답에 포함하지 않는다. 등록/수정으로 `description`이 바뀌면 서버가 임베딩을 다시 만든다. LLM 서버가 응답하지 않아도 등록/수정은 성공하며, 그 차량은 임베딩이 채워질 때까지(`npm run embed:backfill`) RAG 후보에서 빠지고 규칙 기반 폴백에서만 잡힐 수 있다.

## GET /vehicles
쿼리(전부 선택): `q`(차량번호·브랜드·모델·색상 부분 검색), `category`, `status`, `damageAllowed`(`true`/`false`), `page`, `pageSize`. 정렬: 브랜드, 모델, 연식 내림차순.
```json
{ "items": [ { "...Vehicle..." } ], "page": 1, "pageSize": 20, "total": 69 }
```

## GET /vehicles/summary
시작 화면 "보유 차량" 분류별 대수. `status=AVAILABLE`만 센다.
```json
{ "total": 69, "byCategory": { "COMPACT": 4, "SEDAN": 24, "SUV": 18, "VAN": 9, "TRUCK": 7, "SPORTS": 5, "CLASSIC": 2, "OTHER": 0 } }
```

## POST /vehicles — 등록
필수: `plateNo`(중복 불가), `brand`, `model`, `year`, `category`, `dailyRate`(≥0). 선택: `color`, `seats`, `damageAllowed`(기본 `false`), `status`(기본 `AVAILABLE`), `description`.
응답 `201` — Vehicle. 차량번호 중복은 `409`.

## GET /vehicles/:id
Vehicle. `404` 없음.

## PATCH /vehicles/:id
보낸 필드만 수정. 응답 `200` — Vehicle. 단가를 바꿔도 **이미 만든 견적서의 단가는 바뀌지 않는다** (견적 시점 값 복사).

## DELETE /vehicles/:id
응답 `204`. 견적서 항목에서 쓰이고 있으면 삭제하지 않고 `409` (`status: INACTIVE`로 바꿀 것). 매칭 후보에만 있던 경우는 후보도 함께 삭제.
