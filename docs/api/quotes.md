# 견적서 API

## 계산 규칙 (서버가 계산, 프론트는 표시만)
- 항목 `days` = `endDate - startDate + 1` (양 끝 포함). 기간이 없으면 `null`, 소계는 추가 비용만 더한다.
- 항목 `subtotal` = `unitPrice × quantity × days + extraAmount`
- `supplyAmount` = 항목 소계 합
- `taxAmount` = `floor(supplyAmount × 0.1)` (부가세 10% 별도 고정. 포함/별도 선택은 Q6 결정 후 확장)
- `totalAmount` = `supplyAmount + taxAmount`
- 항목이 바뀌면 합계는 같은 응답에서 재계산되어 내려온다.

## Quote 객체
```json
{
  "id": "e5f60718-293a-4b4c-8d5e-6f7081920a3b",
  "quoteNo": "Q-2026-0001",
  "version": 1,
  "status": "DRAFT",
  "isLatest": true,
  "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
  "title": "서울의 밤",
  "productionCompany": "한빛스튜디오",
  "periodStart": "2026-11-03",
  "periodEnd": "2026-11-21",
  "days": 19,
  "author": null,
  "validUntil": "2026-11-18",
  "memo": null,
  "supplyAmount": 1150000,
  "taxAmount": 115000,
  "totalAmount": 1265000,
  "unassignedCount": 1,
  "items": [
    {
      "id": "11112222-3333-4444-5555-666677778888",
      "vehicleId": "a1b2c3d4-0000-4000-8000-000000000001",
      "requirementId": "b3a1c4f0-1d2e-4f5a-9b6c-7d8e9f001122",
      "vehicle": {
        "plateNo": "12가 3456", "brand": "제네시스", "model": "G90",
        "year": 2023, "color": "검정", "category": "SEDAN"
      },
      "label": null,
      "role": "LEAD",
      "usage": "CHASE",
      "damageExpected": true,
      "sceneNos": [12, 14, 15],
      "quantity": 1,
      "startDate": "2026-11-03",
      "endDate": "2026-11-07",
      "days": 5,
      "unitPrice": 220000,
      "extraAmount": 50000,
      "subtotal": 1150000,
      "memo": "파손 위험 할증 별도 협의"
    }
  ],
  "createdAt": "2026-10-19T03:30:00.000Z",
  "updatedAt": "2026-10-19T03:30:00.000Z"
}
```
- `isLatest`: 같은 `quoteNo`에서 가장 높은 버전이면 `true`. 새 버전을 만들면 이전 버전은 `false`가 된다 (읽을 때마다 계산). 이전 버전은 수정할 수 없다.
- `title`, `productionCompany`는 생성 시점의 대본 값을 **복사 저장**한 것이다. 대본이 삭제돼도 남고, `scriptId`만 `null`이 된다.
- 차량을 정하지 못한 항목("차량 미정"): `vehicleId: null`, `vehicle: null`, `unitPrice: 0`, `label`에 "경차 2대 필요" 같은 표시 문구가 들어간다. `unassignedCount`는 이런 항목 수. 담당자가 `PATCH`로 `vehicleId`를 채운다.
- `sceneNos`는 숫자 배열. 목록 응답(`GET /quotes`)의 항목에는 `items` 대신 `itemCount`만 온다.

## POST /quotes — 생성
확정된 매칭(선택된 후보)으로 견적서를 만든다.
```json
{ "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11", "author": "김민지", "validUntil": "2026-11-18" }
```
필수: `scriptId`. 선택: `author`, `validUntil`(기본 생성일 +30일), `periodStart`/`periodEnd`(기본 대본의 촬영 기간, 없으면 분석에서 찾은 일정 단서, 그래도 없으면 `null`).
- 선택된 후보의 차량마다 항목 1개를 만든다 (`quantity` = 그 차량의 선택 건수 기준 1, 요구사항이 2대를 필요로 하고 차량 2대를 골랐으면 항목 2개). 단가는 현재 `dailyRate` 복사.
- 같은 차량이 서로 다른 요구사항에서 선택되면 요구사항별로 항목이 따로 생긴다 (합치지 않음). 항목 순서는 씬 번호 순.
- 선택이 부족한 요구사항은 부족한 대수만큼 "차량 미정" 항목 1개(`quantity` = 부족 대수)로 넣는다.
- 기간은 항목의 `startDate`/`endDate`에 견적서 기간을 그대로 넣는다 (씬별 일정 단서가 있으면 그 날짜 범위).
- `quoteNo`는 `Q-{연도}-{4자리 일련번호}` 자동 채번, `version: 1`, `status: "DRAFT"`.
응답 `201` — Quote. 대본 상태가 `ANALYZED`가 아니면 `409`, 없는 대본이면 `404`.

## GET /quotes
쿼리: `status`, `scriptId`, `q`(견적서 번호·작품명·제작사), `page`, `pageSize`. 정렬: 최신순. 같은 `quoteNo`의 이전 버전도 목록에 나오되 `isLatest`로 구분한다.
```json
{
  "items": [
    {
      "id": "e5f60718-293a-4b4c-8d5e-6f7081920a3b",
      "quoteNo": "Q-2026-0001", "version": 2, "isLatest": true, "status": "REVIEW",
      "scriptId": "6f1c0b52-6a43-4d0e-9d3e-0a8f1b6a1c11",
      "title": "서울의 밤", "productionCompany": "한빛스튜디오",
      "periodStart": "2026-11-03", "periodEnd": "2026-11-21",
      "totalAmount": 1265000, "itemCount": 14, "unassignedCount": 0,
      "author": "김민지", "createdAt": "2026-10-19T03:30:00.000Z"
    }
  ],
  "page": 1, "pageSize": 20, "total": 1
}
```

## GET /quotes/:id
Quote (items 포함). `404` 없음.

## PATCH /quotes/:id — 헤더 수정
수정 가능: `status`, `periodStart`, `periodEnd`, `validUntil`, `author`, `memo`. 응답 `200` — Quote.
- `CONFIRMED`/`SENT` 상태의 견적서는 `status` 외 필드를 바꾸면 `409` (고치려면 `revisions`로 새 버전).
- `periodStart`/`periodEnd`를 바꿔도 항목 기간은 자동으로 바뀌지 않는다 (항목별 `PATCH`).
- `periodEnd`가 `periodStart`보다 빠르면 `400`.
- **최신 버전이 아닌** 견적서는 읽기 전용이다: `PATCH`(status 포함)와 항목 추가/수정/삭제 모두 `409`.
- 항목 추가/수정/삭제도 `SENT`/`CONFIRMED` 상태에서는 `409`.

## POST /quotes/:id/items — 항목 추가
```json
{
  "vehicleId": "a1b2c3d4-0000-4000-8000-000000000002",
  "role": "SUPPORT", "usage": "NORMAL", "quantity": 1,
  "startDate": "2026-11-03", "endDate": "2026-11-05",
  "unitPrice": 180000, "extraAmount": 0, "memo": null, "sceneNos": []
}
```
필수: `quantity`. `vehicleId` 생략 시 "차량 미정"(`label` 필수). `unitPrice` 생략 시 차량의 현재 일 단가. `startDate`/`endDate` 생략 시 견적서 기간. 응답 `201` — **Quote 전체**(합계 갱신 반영).

## PATCH /quotes/:id/items/:itemId — 항목 수정
수정 가능: `vehicleId`(바꾸면 `unitPrice`도 새 차량의 현재 단가로 갱신, 단 같은 요청에 `unitPrice`가 있으면 그 값 우선), `label`, `role`, `usage`, `quantity`, `startDate`, `endDate`, `unitPrice`, `extraAmount`, `memo`, `sceneNos`. 응답 `200` — **Quote 전체**.

## DELETE /quotes/:id/items/:itemId
응답 `200` — **Quote 전체**.

## POST /quotes/:id/revisions — 새 버전 만들기
현재 견적서를 복사해 같은 `quoteNo`로 `version + 1`, `status: "DRAFT"` 새 행을 만든다. 이전 버전은 그대로 보존(읽기 전용 취급). 최신 버전이 아닌 것에 호출하면 `409`.
응답 `201` — 새 Quote.

## POST /quotes/:id/save — 일괄 저장
편집 화면의 [저장]용. 헤더 변경과 항목 추가·수정·삭제를 **한 번에, 전부 반영되거나 전부 반영되지 않게** 처리한다. 하나라도 실패하면(404/400/409) 아무것도 저장되지 않고 견적서는 요청 전 그대로다.
```json
{
  "header": { "status": "REVIEW", "memo": "검토 요청", "validUntil": "2026-12-31" },
  "items": {
    "update": [
      { "id": "11112222-3333-4444-5555-666677778888", "quantity": 2, "extraAmount": 50000, "vehicleId": null }
    ],
    "remove": ["99990000-1111-4222-8333-444455556666"],
    "add": [
      { "label": "경차 2대 필요", "quantity": 2, "startDate": "2026-11-03", "endDate": "2026-11-05" }
    ]
  }
}
```
- `header`, `items`, 그리고 `items` 안의 `add`/`update`/`remove`는 모두 선택. 보낸 것만 반영하고 `{}`이면 변경 없이 현재 견적서를 돌려준다.
- `header`: `PATCH /quotes/:id`와 같은 필드·규칙. `items.add[]`: `POST /quotes/:id/items`와 같은 본문. `items.update[]`: `PATCH /quotes/:id/items/:itemId` 본문 + 항목 `id`. `items.remove[]`: 항목 ID 배열. 각 배열 최대 200개.
- 처리 순서: 삭제 → 수정 → 추가 → 헤더. 합계는 마지막에 한 번만 재계산한다. 추가 항목의 날짜를 생략하면 **저장 전** 견적서 기간이 들어가므로, 헤더 기간과 함께 바꿀 때는 `add`에 `startDate`/`endDate`를 직접 넣을 것.
- 상태도 같은 요청에서 바꿀 수 있다. 예: 항목을 고치면서 `status: "CONFIRMED"`를 보내면 항목은 확정 전 상태 기준으로 검사되고, 저장 후 확정된다. 이미 `SENT`/`CONFIRMED`이면 항목·헤더 변경은 `409` (`status` 변경만 허용).
- 최신 버전이 아닌 견적서는 `409`. 존재하지 않는 항목 ID(이 견적서의 항목이 아닌 것 포함)나 차량은 `404`.
- 응답 `200` — **Quote 전체** (`isLatest`, 재계산된 합계 포함).
- 기존 단건 API(`PATCH /quotes/:id`, `/items` 계열)는 그대로 쓸 수 있다.
