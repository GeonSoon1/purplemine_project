# 분석 결과 · 요구사항 · 매칭 API

분석은 업로드 후 자동으로 돌며, 끝나면 씬/요구사항/매칭 후보가 저장된다. 이 문서의 API는 `ANALYZED` 이후에 쓴다.

## GET /scripts/:id/analysis
분석 결과 전체. `status`가 `ANALYZED`가 아니면 `scenes`는 빈 배열.

```json
{
  "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
  "status": "ANALYZED",
  "analysisModel": "mock-rule-v1",
  "promptVersion": "v1",
  "shootSchedule": { "start": "2026-11-03", "end": "2026-11-21", "hints": ["11월 첫째 주 야간 촬영"] },
  "summary": { "requirementCount": 5, "selectedCount": 1, "noCandidateCount": 1, "pendingCount": 3 },
  "scenes": [
    {
      "id": "0d4d3d2e-7c0b-4d57-8c07-2b6c2d5e9a01",
      "sceneNo": 12,
      "location": "한강 주차장",
      "timeOfDay": "NIGHT",
      "summary": "주인공이 검은 세단을 타고 추격자를 따돌린다",
      "sourceText": "S#12. 한강 주차장 / 밤\n검은색 제네시스 G90이 ...",
      "shootDateHint": null,
      "requirements": [
        {
          "id": "b3a1c4f0-1d2e-4f5a-9b6c-7d8e9f001122",
          "sceneId": "0d4d3d2e-7c0b-4d57-8c07-2b6c2d5e9a01",
          "sceneNo": 12,
          "role": "LEAD",
          "vehicleType": "고급 세단",
          "categoryHint": "SEDAN",
          "brandModelHint": "제네시스 G90",
          "quantity": 1,
          "usage": "CHASE",
          "damageExpected": false,
          "sourceQuote": "검은색 제네시스 G90이 시동을 건 채 대기한다",
          "confidence": 0.93,
          "isUserEdited": false,
          "selectedCount": 1,
          "candidates": [
            {
              "id": "c9e8d7f6-0a1b-4c2d-8e3f-4a5b6c7d8e90",
              "vehicleId": "a1b2c3d4-0000-4000-8000-000000000001",
              "score": 92,
              "reason": "차명이 대본과 일치, 파손 촬영 가능",
              "rank": 1,
              "isSelected": true,
              "vehicle": {
                "id": "a1b2c3d4-0000-4000-8000-000000000001",
                "plateNo": "12가 3456",
                "brand": "제네시스",
                "model": "G90",
                "year": 2023,
                "category": "SEDAN",
                "color": "검정",
                "dailyRate": 220000,
                "damageAllowed": true
              }
            }
          ]
        }
      ]
    }
  ]
}
```
- 씬은 `sceneNo` 오름차순, 요구사항은 씬 안에서 생성 순. 후보는 `rank` 오름차순(= 점수 내림차순).
- `score`: 0~100 정수. `reason`: 한국어 한 문장.
- `categoryHint`, `brandModelHint`, `shootDateHint`는 없으면 `null`. `confidence`는 0~1, 수동 추가는 `null`.
- 가장 높은 후보를 **자동 선택하지 않는다** (`isSelected`는 사람이 지정해야 `true`). 위 예시의 `true`는 선택 후의 모습.
- `summary`: `selectedCount` 선택 완료(선택 대수 ≥ 필요 대수) · `noCandidateCount` 후보 0건 · `pendingCount` 나머지. 합은 `requirementCount`.
- `shootSchedule`: 대본에서 찾은 일정 단서. 없으면 `start`/`end` `null`, `hints` `[]`.

### 후보 산정 규칙 (RAG 우선 + 규칙 기반 폴백, 참고)
후보는 요구사항 생성·분석 저장·`rematch` 때 계산된다. `status=AVAILABLE` 차량만 대상.

1. **RAG (우선)**: LLM 서버 `POST /match`(차량 설명 임베딩의 pgvector 유사도 검색)가 돌려준 상위 5개를 쓴다. `score`는 서버가 준 0~100 정수, `reason`은 서버가 준 한국어 문장이다. `score` 내림차순으로 `rank`를 매기며, 존재하지 않거나 `AVAILABLE`이 아닌 차량은 버린다.
2. **규칙 기반 (폴백)**: `/match`가 오류·타임아웃(5xx 포함)이거나 결과가 비어 있거나(후보가 모두 걸러진 경우 포함) `MATCH_MODE=rule`이면 아래 규칙을 쓴다.
   점수 = 분류 일치 40 + 차명 일치(전체 50 / 모델 40 / 브랜드 20) + 색상 일치 10 + 파손 촬영 가능 10(파손 예상 요구사항) + 차종 설명 키워드 5, 상한 100. 분류·차명·키워드 중 일치가 하나도 없으면 후보가 아니고, 파손 예상(`damageExpected` 또는 `usage: DAMAGE`)이면 `damageAllowed: false` 차량은 제외한다. 점수 동률이면 일 단가가 낮은 차량이 먼저, 상위 5개. `categoryHint`가 없으면 `vehicleType` 문구에서 분류를 추정한다.

프론트 관점에서 달라지는 것은 없다: 응답 형태는 같고, 어느 경로를 탔는지는 응답에 노출하지 않는다(서버 로그에만 남음). 분석 저장은 후보 계산(외부 호출)을 먼저 끝낸 뒤 한 트랜잭션으로 저장하므로, 요구사항이 많으면 분석 완료까지 시간이 조금 더 걸릴 수 있다 (`ANALYZING` 폴링으로 충분).

## POST /scripts/:id/requirements — 요구사항 수동 추가
```json
{
  "sceneId": "0d4d3d2e-7c0b-4d57-8c07-2b6c2d5e9a01",
  "role": "BACKGROUND",
  "vehicleType": "경차",
  "categoryHint": "COMPACT",
  "brandModelHint": null,
  "quantity": 2,
  "usage": "NORMAL",
  "damageExpected": false,
  "sourceQuote": null
}
```
필수: `sceneId`, `role`, `vehicleType`, `quantity`(≥1), `usage`. 나머지 선택(생략 시 `null`/`false`).
응답 `201` — requirement 객체(후보 포함, `isUserEdited: true`). 후보는 즉시 계산된다. `sceneId`가 이 대본의 씬이 아니면 `404`.

## PATCH /requirements/:id — 수정
보낸 필드만 바꾼다: `role`, `vehicleType`, `categoryHint`, `brandModelHint`, `quantity`, `usage`, `damageExpected`, `sourceQuote`.
응답 `200` — requirement 객체, `isUserEdited: true`.
`vehicleType`만 바꾸고 `categoryHint`를 보내지 않으면 서버가 새 차종 문구에서 분류를 다시 추정해 `categoryHint`를 갱신한다 (추정 못 하면 `null`). `categoryHint`를 보내면 그 값을 그대로 쓴다.
**후보는 자동으로 다시 계산하지 않는다.** 차종 관련 필드(`vehicleType`, `categoryHint`, `brandModelHint`, `usage`, `damageExpected`)를 바꾸면 응답에 `"candidatesStale": true`가 붙고, 프론트는 "후보를 다시 찾으시겠습니까?" 배너를 보여 `rematch`를 호출한다. `quantity`만 바꾸면 선택은 유지된다.

## DELETE /requirements/:id
응답 `204`. 후보와 선택도 함께 삭제. 이미 견적서에 들어간 항목은 `requirementId`만 `null`이 되고 유지된다.

## POST /requirements/:id/rematch — 후보 다시 찾기
현재 요구사항 내용으로 후보를 다시 계산해(RAG 우선, 폴백 규칙 기반) 교체한다. 이미 선택한 차량이 새 후보에도 있으면 선택을 유지하고, 없으면 선택이 풀린다. 직접 선택한 차량(`reason: "직접 선택"`)은 유지된다.
응답 `200` — requirement 객체.

## PUT /requirements/:id/selection — 선택 차량 지정
선택 상태를 통째로 교체한다 (토글 UI는 현재 선택 목록에서 더하고/빼서 보낸다).
```json
{ "vehicleIds": ["a1b2c3d4-0000-4000-8000-000000000001"] }
```
- 빈 배열이면 선택 해제. 최대 `quantity`개까지만 허용 (넘으면 `400`).
- 후보에 없는 `vehicleId`는 "직접 선택" 후보(`score: 0`, `reason: "직접 선택"`)로 목록 끝에 추가되고 선택된다 ([다른 차량 찾기] 모달). 존재하지 않는 차량이면 `404`.
- 응답 `200` — requirement 객체 (`selectedCount` 갱신).
