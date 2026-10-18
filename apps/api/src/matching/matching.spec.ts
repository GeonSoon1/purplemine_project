import { Usage, VehicleCategory } from '../common/enums';
import {
  colorFamily,
  inferCategory,
  MatchableRequirement,
  MatchableVehicle,
  normalize,
  rankCandidates,
  scoreVehicle,
} from './matching';

const veh = (o: Partial<MatchableVehicle> & { id: string }): MatchableVehicle => ({
  brand: '현대',
  model: '쏘나타',
  category: VehicleCategory.SEDAN,
  color: '흰색',
  damageAllowed: true,
  dailyRate: 100000,
  description: '',
  ...o,
});

const req = (o: Partial<MatchableRequirement> = {}): MatchableRequirement => ({
  vehicleType: '세단',
  categoryHint: null,
  brandModelHint: null,
  usage: Usage.NORMAL,
  damageExpected: false,
  sourceQuote: null,
  ...o,
});

describe('matching', () => {
  describe('normalize / infer', () => {
    it('공백·기호 제거, 영문 브랜드를 한글로 통일', () => {
      expect(normalize('Genesis G-90')).toBe('제네시스g90');
      expect(normalize('제네시스 G90')).toBe('제네시스g90');
    });
    it('차종 문구에서 분류 추정', () => {
      expect(inferCategory('고급 세단')).toBe(VehicleCategory.SEDAN);
      expect(inferCategory('경차')).toBe(VehicleCategory.COMPACT);
      expect(inferCategory('구급차')).toBe(VehicleCategory.VAN);
      expect(inferCategory('헬리콥터')).toBeNull();
    });
    it('색상 계열', () => {
      expect(colorFamily('검은색 세단')).toBe('검정');
      expect(colorFamily('블랙')).toBe('검정');
      expect(colorFamily('화이트')).toBe('흰색');
      expect(colorFamily(null)).toBeNull();
    });
  });

  describe('scoreVehicle', () => {
    it('차명 + 분류 일치는 높은 점수와 한국어 사유', () => {
      const r = scoreVehicle(
        req({ categoryHint: VehicleCategory.SEDAN, brandModelHint: '제네시스 G90' }),
        veh({ id: 'a', brand: '제네시스', model: 'G90' }),
      )!;
      expect(r.score).toBeGreaterThanOrEqual(90);
      expect(r.reason).toBe('차명이 대본과 일치, 분류(세단) 일치');
    });

    it('브랜드만 같으면 브랜드 일치(20점)', () => {
      const r = scoreVehicle(req({ categoryHint: null, vehicleType: '고급차', brandModelHint: '제네시스 G90' }), veh({ id: 'a', brand: '제네시스', model: 'G80' }))!;
      expect(r.score).toBe(20);
      expect(r.reason).toBe('브랜드 일치');
    });

    it('색상 일치 가산', () => {
      const base = req({ categoryHint: VehicleCategory.SEDAN, sourceQuote: '검은색 세단이 선다' });
      const black = scoreVehicle(base, veh({ id: 'a', color: '검정' }))!;
      const white = scoreVehicle(base, veh({ id: 'b', color: '흰색' }))!;
      expect(black.score - white.score).toBe(10);
      expect(black.reason).toContain('색상(검정) 일치');
    });

    it('파손 예상이면 파손 불가 차량은 후보에서 제외, 가능 차량은 +10', () => {
      const r = req({ categoryHint: VehicleCategory.SEDAN, damageExpected: true });
      expect(scoreVehicle(r, veh({ id: 'a', damageAllowed: false }))).toBeNull();
      const ok = scoreVehicle(r, veh({ id: 'b', damageAllowed: true }))!;
      expect(ok.reason).toContain('파손 촬영 가능');
      expect(ok.score).toBe(40 + 10);
    });

    it('usage 가 DAMAGE 여도 파손 불가 제외', () => {
      expect(scoreVehicle(req({ categoryHint: VehicleCategory.SEDAN, usage: Usage.DAMAGE }), veh({ id: 'a', damageAllowed: false }))).toBeNull();
    });

    it('신호가 전혀 없으면 후보가 아님', () => {
      expect(scoreVehicle(req({ vehicleType: '헬리콥터' }), veh({ id: 'a' }))).toBeNull();
      expect(scoreVehicle(req({ categoryHint: VehicleCategory.TRUCK }), veh({ id: 'a' }))).toBeNull();
    });

    it('점수는 100 을 넘지 않는다', () => {
      const r = scoreVehicle(
        req({ categoryHint: VehicleCategory.SEDAN, brandModelHint: '제네시스 G90', sourceQuote: '검은색 제네시스 G90', damageExpected: true }),
        veh({ id: 'a', brand: '제네시스', model: 'G90', color: '검정', description: '제네시스 G90 세단' }),
      )!;
      expect(r.score).toBe(100);
    });
  });

  describe('rankCandidates', () => {
    const vehicles = [
      veh({ id: 'v1', brand: '현대', model: '그랜저', dailyRate: 130000 }),
      veh({ id: 'v2', brand: '현대', model: '쏘나타', dailyRate: 90000 }),
      veh({ id: 'v3', brand: '기아', model: 'K5', dailyRate: 85000 }),
      veh({ id: 'v4', brand: '기아', model: 'K8', dailyRate: 140000 }),
      veh({ id: 'v5', brand: '현대', model: '아반떼', dailyRate: 70000 }),
      veh({ id: 'v6', brand: '현대', model: '엑센트', dailyRate: 60000 }),
      veh({ id: 'suv', brand: '현대', model: '투싼', category: VehicleCategory.SUV }),
    ];

    it('상위 5개만, 분류가 다른 차량 제외, rank 1..n', () => {
      const out = rankCandidates(req({ categoryHint: VehicleCategory.SEDAN }), vehicles);
      expect(out).toHaveLength(5);
      expect(out.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(out.find((o) => o.vehicleId === 'suv')).toBeUndefined();
    });

    it('점수 동률이면 일 단가가 낮은 차량이 먼저', () => {
      const out = rankCandidates(req({ categoryHint: VehicleCategory.SEDAN }), vehicles);
      expect(out.map((o) => o.vehicleId)).toEqual(['v6', 'v5', 'v3', 'v2', 'v1']);
    });

    it('차명 일치가 1순위', () => {
      const out = rankCandidates(req({ categoryHint: VehicleCategory.SEDAN, brandModelHint: '현대 그랜저' }), vehicles);
      expect(out[0].vehicleId).toBe('v1');
      expect(out[0].reason).toContain('차명이 대본과 일치');
    });

    it('후보가 없으면 빈 배열', () => {
      expect(rankCandidates(req({ vehicleType: '헬리콥터' }), vehicles)).toEqual([]);
    });
  });
});
