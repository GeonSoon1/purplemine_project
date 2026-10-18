# API 명세 (apps/api, NestJS)

> frontend(`apps/web`)가 보는 문서. 상태: v0.2
> 개별 명세: [scripts](scripts.md) · [analysis](analysis.md) · [vehicles](vehicles.md) · [quotes](quotes.md) · [llm 서버(내부용)](llm.md)

## 공통 규칙

| 항목 | 값 |
|---|---|
| Base URL | `http://localhost:4000/api` |
| 형식 | JSON (`Content-Type: application/json`), 대본 업로드만 `multipart/form-data` |
| 필드명 | camelCase |
| ID | UUID 문자열 |
| 날짜 | `YYYY-MM-DD`, 시각은 ISO 8601 UTC (`2026-10-19T03:21:00.000Z`) |
| 금액 | 원(KRW) 정수. 소수 없음 |
| 인증 | 없음 (MVP, 요구사항 Q2 미정). 도입 시 이 문서 갱신 |
| 빈 값 | 값이 없으면 `null` (필드 생략 안 함) |

### 오류 응답
모든 오류는 같은 형태.
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["title should not be empty"]
}
```
`message`는 문자열 또는 문자열 배열. 코드: 400 검증 실패 · 404 없음 · 409 상태 충돌(예: 분석 중인 대본 재분석) · 413 파일 과대 · 415 지원 안 하는 파일 형식 · 502 LLM 서버 오류 · 500 서버 오류.

### 목록 응답 (페이지네이션)
`GET` 목록은 `?page=1&pageSize=20` 지원 (기본 1/20, 최대 100).
```json
{ "items": [ ... ], "page": 1, "pageSize": 20, "total": 53 }
```

### Enum

| 이름 | 값 |
|---|---|
| ScriptStatus | `UPLOADED` 업로드됨 · `ANALYZING` 분석중 · `ANALYZED` 완료 · `FAILED` 실패 |
| TimeOfDay | `DAY` · `NIGHT` · `DAWN` · `DUSK` · `UNKNOWN` |
| Role | `LEAD` 주인공 · `SUPPORT` 조연 · `BACKGROUND` 배경 |
| Usage | `NORMAL` 일반 주행 · `CHASE` 추격 · `ACTION` 액션 · `DAMAGE` 파손 |
| VehicleCategory | `COMPACT` 경차 · `SEDAN` · `SUV` · `VAN` 승합 · `TRUCK` · `SPORTS` · `CLASSIC` · `OTHER` |
| VehicleStatus | `AVAILABLE` · `MAINTENANCE` · `INACTIVE` |
| QuoteStatus | `DRAFT` 초안 · `REVIEW` 검토중 · `SENT` 발송 · `CONFIRMED` 확정 |

### 엔드포인트 한눈에 보기

| 영역 | Method | Path | 설명 | 문서 |
|---|---|---|---|---|
| 대본 | POST | `/scripts` | 업로드 + 분석 시작 | scripts |
| | GET | `/scripts` | 목록 | scripts |
| | GET | `/scripts/:id` | 상세/상태 (폴링) | scripts |
| | DELETE | `/scripts/:id` | 삭제(원본·파생 데이터 포함) | scripts |
| | POST | `/scripts/:id/analyze` | 재분석 | scripts |
| 분석 결과 | GET | `/scripts/:id/analysis` | 씬 + 요구사항 + 후보 | analysis |
| | POST | `/scripts/:id/requirements` | 요구사항 수동 추가 | analysis |
| | PATCH | `/requirements/:id` | 요구사항 수정 | analysis |
| | DELETE | `/requirements/:id` | 요구사항 삭제 | analysis |
| 매칭 | POST | `/requirements/:id/rematch` | 후보 다시 찾기 | analysis |
| | PUT | `/requirements/:id/selection` | 선택 차량 지정 | analysis |
| 차량 | GET/POST | `/vehicles` | 목록·검색 / 등록 | vehicles |
| | GET | `/vehicles/summary` | 분류별 대수 | vehicles |
| | GET/PATCH/DELETE | `/vehicles/:id` | 상세 / 수정 / 삭제 | vehicles |
| 견적서 | POST | `/quotes` | 선택된 매칭으로 생성 | quotes |
| | GET | `/quotes` | 목록 | quotes |
| | GET/PATCH | `/quotes/:id` | 상세 / 헤더 수정 | quotes |
| | POST | `/quotes/:id/items` | 항목 추가 | quotes |
| | PATCH/DELETE | `/quotes/:id/items/:itemId` | 항목 수정 / 삭제 | quotes |
| | POST | `/quotes/:id/save` | 헤더 + 항목 일괄 저장(전부 또는 전무) | quotes |
| | POST | `/quotes/:id/revisions` | 새 버전(v+1) 만들기 | quotes |

### 아직 없는 것 (명세 외)
- 견적서 내보내기(PDF/엑셀, F-33), 로그인(F-40), 차량 가용 일정(Q9), 작품 단위 묶기(Q12)
- 후보 매칭은 **LLM 서버의 pgvector RAG 매칭(`POST /match`)을 우선** 쓰고, LLM 서버 오류·타임아웃이거나 결과가 비면 **규칙 기반(분류·차명·파손 가능 여부·키워드)으로 폴백**한다 (`MATCH_MODE=rule`이면 규칙 기반만). 어느 경로든 `score`/`reason` 산출 방식만 다르고 응답 형태는 같다.

### 변경 이력
- v0.1 최초 작성
- v0.1.1 구현 반영(apps/api): 업로드 `400` 사유 추가, 이전 버전 견적서 읽기 전용·항목 편집 잠금 명시, 후보 산정 규칙 추가. 응답 JSON 형태 변경 없음.
- v0.2 후보 매칭을 RAG 우선 + 규칙 기반 폴백으로 변경, 차량 등록/수정 시 설명 임베딩 자동 생성(실패해도 등록/수정은 성공). 응답 JSON 형태 변경 없음 (`score`/`reason` 값의 산출 방식만 달라짐).
- v0.2.1 `GET /quotes/:id` 응답(및 견적서를 돌려주는 모든 응답)에 `isLatest` 추가. `PATCH /requirements/:id`에서 `vehicleType`만 바꾸면 `categoryHint`를 문구에서 다시 추정
- v0.3 `POST /quotes/:id/save` 추가 (견적서 헤더 + 항목 추가/수정/삭제 일괄 저장, 트랜잭션)
- v0.3.1 대본 업로드에 `.hwpx` 추가 (`fileType: "hwpx"`). 구버전 `.hwp`는 415
