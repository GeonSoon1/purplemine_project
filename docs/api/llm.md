# LLM 서버 API (services/llm, FastAPI) — 내부용

> NestJS(`apps/api`)만 호출한다. 프론트와 외부에 직접 노출하지 않는다.
> Base URL: `http://localhost:8000` (NestJS 환경변수 `LLM_SERVER_URL`)
> 상태: v0.2 (`/embed`, `/match` 추가. `/analyze`는 변경 없음)

## 설계 결정
- **동기 응답**: `POST /analyze`는 분석이 끝나면 결과를 바로 응답한다 (콜백/폴링 없음, 아키텍처 질문 A2의 MVP 결정). NestJS가 이 호출을 백그라운드로 돌리고 대본 `status`를 갱신하므로 프론트는 막히지 않는다. 클라이언트 타임아웃은 120초 이상으로 둔다.
- **DB 접근은 `/match`만, 읽기 전용**: `/analyze`와 `/embed`는 DB를 쓰지 않는다. `/match`만 `DATABASE_URL`로 `vehicles`를 조회하며, 연결을 `read_only` 트랜잭션으로 열어 쓰기를 DB 수준에서 막는다. 차량 임베딩 저장(쓰기)은 NestJS 몫이다.
- **프로바이더**: 환경변수 `LLM_PROVIDER` = `mock` (기본, 키 없이 동작하는 규칙 기반 추출기) | `anthropic` | `openai`. API 키는 `.env`로만 (`ANTHROPIC_API_KEY` 등). 외부 LLM으로 대본 전송 가능 여부는 계약 확인 전이므로 기본값은 `mock`.
- 출력은 Pydantic 모델로 검증한다. 검증 실패 시 1회 재시도 후 `502`.

## GET /health
```json
{ "status": "ok", "provider": "mock", "model": "mock-rule-v1", "promptVersion": "v1" }
```

## POST /analyze — 대본 분석 (씬 분할 + 차량 요구사항 추출)

### 요청
```json
{
  "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
  "text": "S#1. 서울 도심 도로 / 낮\n...",
  "hints": { "shootStart": "2026-11-03", "shootEnd": "2026-11-21" }
}
```
| 필드 | 필수 | 설명 |
|---|---|---|
| `scriptId` | O | 추적용 ID (로그/응답 에코). 대본 내용은 로그에 남기지 않는다 |
| `text` | O | 대본 본문 (UTF-8, 1자 이상, 최대 500,000자) |
| `hints` | | 이미 아는 촬영 기간. 없으면 `null` |

### 응답 `200`
```json
{
  "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
  "model": "mock-rule-v1",
  "promptVersion": "v1",
  "scenes": [
    {
      "sceneNo": 12,
      "location": "한강 주차장",
      "timeOfDay": "NIGHT",
      "summary": "주인공이 검은 세단을 타고 추격자를 따돌린다",
      "sourceText": "S#12. 한강 주차장 / 밤\n검은색 제네시스 G90이 ...",
      "shootDateHint": null,
      "vehicles": [
        {
          "role": "LEAD",
          "vehicleType": "고급 세단",
          "categoryHint": "SEDAN",
          "brandModelHint": "제네시스 G90",
          "quantity": 1,
          "usage": "CHASE",
          "damageExpected": false,
          "sourceQuote": "검은색 제네시스 G90이 시동을 건 채 대기한다",
          "confidence": 0.93
        }
      ]
    }
  ],
  "shootSchedule": { "start": null, "end": null, "hints": ["11월 첫째 주 야간 촬영"] }
}
```

### 필드 규칙
| 필드 | 타입 | 규칙 |
|---|---|---|
| `scenes[].sceneNo` | int | 대본의 씬 번호. 번호가 없으면 등장 순서 1부터. 중복 불가 |
| `scenes[].location` | string \| null | 장소 |
| `scenes[].timeOfDay` | `DAY` `NIGHT` `DAWN` `DUSK` `UNKNOWN` | 불명확하면 `UNKNOWN` |
| `scenes[].summary` | string | 한 문장 요약 |
| `scenes[].sourceText` | string | 씬 원문 구간 (그대로) |
| `scenes[].shootDateHint` | `YYYY-MM-DD` \| null | 씬 단위 일정 단서가 날짜로 특정될 때만 |
| `scenes[].vehicles` | array | 차량이 안 나오는 씬은 `[]`. **씬은 차량이 없어도 응답에 포함** |
| `vehicles[].role` | `LEAD` `SUPPORT` `BACKGROUND` | 주인공 차 / 조연 차 / 배경 차 |
| `vehicles[].vehicleType` | string | 차종 요구 한국어 (예 "고급 세단", "경차", "구급차") |
| `vehicles[].categoryHint` | `COMPACT` `SEDAN` `SUV` `VAN` `TRUCK` `SPORTS` `CLASSIC` `OTHER` \| null | 매칭용 분류 |
| `vehicles[].brandModelHint` | string \| null | 대본에 명시된 차명 (예 "제네시스 G90"). 명시 없으면 `null` — **추측해서 채우지 않는다** |
| `vehicles[].quantity` | int ≥ 1 | 대수. "차량 세 대" → 3 |
| `vehicles[].usage` | `NORMAL` `CHASE` `ACTION` `DAMAGE` | 가장 강한 용도 (파손 > 액션 > 추격 > 일반) |
| `vehicles[].damageExpected` | bool | 충돌/전복/폭발/파손이 대본에 있으면 `true` (`usage: DAMAGE`와 함께) |
| `vehicles[].sourceQuote` | string \| null | 근거 원문 인용 (씬 `sourceText`의 부분 문자열) |
| `vehicles[].confidence` | float 0~1 | 추출 신뢰도 |
| `shootSchedule` | object | 대본 전체에서 찾은 일정 단서. 못 찾으면 `start`/`end` `null`, `hints` `[]` |

### 오류
```json
{ "detail": "text must not be empty" }
```
`422` 요청 검증 실패 (FastAPI 기본 형식) · `502` 모델 응답이 스키마에 안 맞음/모델 호출 실패 · `500` 기타.

## 샘플 대본
`services/llm/samples/*.txt` — 가짜 대본. `S#번호. 장소 / 시간대` 형식의 씬 헤더를 쓴다. `data/scripts/`(실제 대본)는 건드리지 않는다.

## POST /embed — 텍스트 임베딩

NestJS가 차량 설명(`passage`)을 임베딩해 `vehicles.embedding`에 저장할 때 쓴다.

### 요청
```json
{ "texts": ["제네시스 G90 2022년식 검정 고급 세단"], "kind": "passage" }
```
| 필드 | 설명 |
|---|---|
| `texts` | 1~64개. 각 항목은 공백만이 아닌 1~4000자. 빈 문자열/공백만 있으면 `422` |
| `kind` | `passage`(저장할 차량 설명) \| `query`(검색 질의). e5 모델 규칙대로 서버가 `passage: ` / `query: ` 접두어를 붙인다. 클라이언트는 접두어를 붙이지 않는다 |

### 응답 `200`
```json
{ "model": "intfloat/multilingual-e5-small", "dimension": 384, "embeddings": [[0.0405, -0.0456, "... 384개"]] }
```
`embeddings`는 `texts`와 같은 순서이고, 각 벡터는 L2 정규화되어 있다 (코사인 유사도 = 내적).

### 오류
`422` 요청 검증 실패 · `503` 모델 로드/호출 실패 (예: 모델 다운로드 불가).

## POST /match — 요구사항 → 보유 차량 후보

### 요청
```json
{
  "requirement": {
    "vehicleType": "고급 세단", "categoryHint": "SEDAN", "brandModelHint": "제네시스 G90",
    "usage": "CHASE", "damageExpected": false, "quantity": 1,
    "sourceQuote": "검은색 제네시스 G90이 시동을 건 채 대기한다"
  },
  "topK": 5
}
```
`requirement`는 `/analyze`의 `vehicles[]` 항목에서 `role`, `confidence`를 뺀 형태다 (`categoryHint`, `brandModelHint`, `sourceQuote`는 `null` 가능). `topK`는 1~50, 기본 5.

### 응답 `200`
```json
{
  "model": "intfloat/multilingual-e5-small",
  "candidates": [
    { "vehicleId": "feaabc70-7e19-466b-81db-9f9a9c206b0f", "score": 89,
      "reason": "제네시스 G90 2022년식 검정: 분류 SEDAN 일치, 차명 '제네시스 G90' 일치, 의미 유사도 92%." }
  ]
}
```
`score`는 0~100 정수, 내림차순. 조건에 맞는 차량이 없으면 `candidates: []`. `reason`은 근거(분류/차명/유사도)를 템플릿으로 만든 한국어 한 문장.

### 매칭 규칙
1. 질의 텍스트 = `vehicleType` + `brandModelHint` + `sourceQuote`를 공백으로 이은 것 → `query`로 임베딩.
2. 후보 조건: `status = 'AVAILABLE' AND embedding IS NOT NULL`. `damageExpected`가 `true`면 `damage_allowed = true`만. (하드 필터)
3. 코사인 거리(`<=>`)순으로 가져와 규칙 점수를 매긴다.
4. 점수(합 100) = 유사도 70 + 분류 20 + 차명 10.
   - 유사도: `(cos - 0.75) / 0.20`을 0~1로 자른 값 × 70. e5-small은 무관한 문장도 0.77~0.80이 나와서(실측) 0.75를 바닥으로 잡았다. 
   - 분류: `categoryHint`와 일치 +20, 불일치 0, 힌트 없음 +10(중립).
   - 차명: `brandModelHint`가 차량 `브랜드+모델`과 포함 관계면 +10.
5. 요청한 `topK`개를 채운다.

### 설계 결정: 분류(`categoryHint`) 처리
**소프트 우선** 방식이다. 같은 분류 차량을 먼저 조회하고, `topK`가 안 차면 분류 필터를 풀어 다른 분류로 채운다. 분류 불일치 차량은 분류 점수 20점을 못 받아 아래로 밀리고 `reason`에 "분류 불일치"가 표기된다. 하드 필터로 하지 않은 이유: `/analyze`의 분류 힌트는 LLM 추정이라 틀릴 수 있고, 보유 차량이 적어 분류가 일치하는 차가 없어도 견적에는 대안이 필요하기 때문이다. 하드 필터가 필요하면 NestJS가 `score` 기준으로 걸러낼 수 있다.

### 오류
`422` 요청 검증 실패 · `503` 임베딩 불가, `DATABASE_URL` 미설정, DB 접속/조회 실패.

## 임베딩 설정 (환경변수)
| 변수 | 기본값 | 설명 |
|---|---|---|
| `EMBEDDING_PROVIDER` | `local` | `local`(sentence-transformers, 외부 전송 없음, 비용 0) \| `openai`(나중용. `OPENAI_API_KEY` 필요, 외부 전송이므로 계약 확인 후에만) |
| `EMBEDDING_MODEL` | local: `intfloat/multilingual-e5-small`, openai: `text-embedding-3-small` | |
| `EMBEDDING_DIM` | `384` | 모델 출력 차원 = `vehicles.embedding` 차원. 모델 출력과 다르면 시작 시 오류 |
| `EMBEDDING_CACHE_DIR` | `services/llm/.cache/models` | 모델 캐시 (git 제외). 모델은 첫 사용 시 내려받아 lazy load |
| `DATABASE_URL` | (없음) | `/match`용 읽기 전용 PostgreSQL 접속 문자열. 로컬: `postgres://purplemine:purplemine@localhost:5433/purplemine` |

### 모델을 바꾸면
임베딩 모델이나 차원을 바꾸면 기존 `vehicles.embedding`과 새 질의 벡터가 서로 다른 공간이 되어 매칭이 틀어진다. **모델 변경 시 모든 차량을 새 모델로 재임베딩**해야 하고, 차원이 바뀌면 `vector(N)` 컬럼 마이그레이션도 필요하다. (`vehicles.embedding_model`로 어떤 모델로 만든 벡터인지 확인할 수 있다.)

### 성능 (참고, CPU)
첫 호출은 모델 로드로 약 9초 (최초 다운로드 시 약 25초 추가), 이후 `/embed` 1건 약 15ms, `/match` 약 30ms.
