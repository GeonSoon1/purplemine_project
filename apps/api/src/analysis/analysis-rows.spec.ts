import { VehicleCategory } from '../common/enums';
import type { LlmAnalyzeResponse } from '../llm/llm.types';
import type { MatchableVehicle } from '../matching/matching';
import { buildAnalysisRows } from './analysis-rows';

const vehicles: MatchableVehicle[] = [
  { id: 'g90', brand: '제네시스', model: 'G90', category: VehicleCategory.SEDAN, color: '검정', damageAllowed: false, dailyRate: 220000, description: '' },
  { id: 'ray', brand: '기아', model: '레이', category: VehicleCategory.COMPACT, color: '은색', damageAllowed: true, dailyRate: 70000, description: '' },
];

const result: LlmAnalyzeResponse = {
  scriptId: 's1',
  model: 'm',
  promptVersion: 'v1',
  shootSchedule: { start: null, end: null, hints: [] },
  scenes: [
    {
      sceneNo: 1, location: '도로', timeOfDay: 'DAY', summary: 's', sourceText: 'x', shootDateHint: null,
      vehicles: [
        { role: 'LEAD', vehicleType: '고급 세단', categoryHint: 'SEDAN', brandModelHint: '제네시스 G90', quantity: 1, usage: 'CHASE', damageExpected: false, sourceQuote: null, confidence: 0.9 },
        { role: 'BACKGROUND', vehicleType: '경차', categoryHint: 'COMPACT', brandModelHint: null, quantity: 2, usage: 'NORMAL', damageExpected: false, sourceQuote: null, confidence: 0.5 },
      ],
    },
    { sceneNo: 2, location: null, timeOfDay: 'NIGHT', summary: '차량 없음', sourceText: 'y', shootDateHint: null, vehicles: [] },
  ],
};

describe('buildAnalysisRows', () => {
  const rows = buildAnalysisRows('s1', result, vehicles);

  it('차량이 없는 씬도 저장 대상에 포함', () => {
    expect(rows.scenes.map((s) => s.sceneNo)).toEqual([1, 2]);
    expect(rows.scenes.every((s) => s.scriptId === 's1')).toBe(true);
  });

  it('요구사항은 씬에 연결되고 사람 수정 아님', () => {
    expect(rows.requirements).toHaveLength(2);
    expect(rows.requirements.every((r) => r.sceneId === rows.scenes[0].id && r.isUserEdited === false)).toBe(true);
  });

  it('후보는 계산되지만 자동 선택되지 않는다', () => {
    expect(rows.candidates.length).toBeGreaterThan(0);
    expect(rows.candidates.every((c) => c.isSelected === false)).toBe(true);
    const g90 = rows.candidates.find((c) => c.vehicleId === 'g90')!;
    expect(g90.requirementId).toBe(rows.requirements[0].id);
    expect(g90.rank).toBe(1);
    expect(rows.candidates.find((c) => c.requirementId === rows.requirements[1].id)?.vehicleId).toBe('ray');
  });
});
