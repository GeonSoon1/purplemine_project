import { VehicleCategory, Usage } from '../common/enums';

/**
 * 규칙 기반 후보 매칭 (RAG 매칭 폴백. LLM /match 실패·빈 결과 또는 MATCH_MODE=rule 일 때 사용).
 * 점수(0~100): 분류 일치 40 + 차명 일치 최대 50 + 색상 10 + 파손 가능 10 + 설명 키워드 5, 상한 100.
 */

export interface MatchableRequirement {
  vehicleType: string;
  categoryHint: VehicleCategory | null;
  brandModelHint: string | null;
  usage: Usage;
  damageExpected: boolean;
  sourceQuote: string | null;
}

export interface MatchableVehicle {
  id: string;
  brand: string;
  model: string;
  category: VehicleCategory;
  color: string | null;
  damageAllowed: boolean;
  dailyRate: number;
  description: string;
}

export interface MatchResult {
  vehicleId: string;
  score: number;
  reason: string;
  rank: number;
}

export const MAX_CANDIDATES = 5;

export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  COMPACT: '경차',
  SEDAN: '세단',
  SUV: 'SUV',
  VAN: '승합',
  TRUCK: '트럭',
  SPORTS: '스포츠카',
  CLASSIC: '클래식카',
  OTHER: '기타',
};

const BRAND_ALIAS: Array<[RegExp, string]> = [
  [/genesis/g, '제네시스'],
  [/hyundai/g, '현대'],
  [/kia/g, '기아'],
  [/mercedesbenz|mercedes|benz/g, '벤츠'],
  [/chevrolet/g, '쉐보레'],
  [/ssangyong/g, '쌍용'],
  [/renaultkorea|renaultsamsung/g, '르노'],
];

/** 소문자화, 공백/기호 제거, 영문 브랜드명을 한글로 통일. */
export const normalize = (s: string): string => {
  let n = s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
  for (const [re, to] of BRAND_ALIAS) n = n.replace(re, to);
  return n;
};

const CATEGORY_KEYWORDS: Array<[VehicleCategory, RegExp]> = [
  [VehicleCategory.COMPACT, /경차|소형차|모닝|레이|캐스퍼/],
  [VehicleCategory.SPORTS, /스포츠카|슈퍼카|쿠페|로드스터/],
  [VehicleCategory.CLASSIC, /클래식|구형|올드카|빈티지|옛날/],
  [VehicleCategory.TRUCK, /트럭|화물|픽업|용달|탑차/],
  [VehicleCategory.VAN, /승합|밴|미니버스|버스|카니발|스타렉스|구급차|캠핑카/],
  [VehicleCategory.SUV, /suv|에스유브이|지프|짚|오프로드/i],
  [VehicleCategory.SEDAN, /세단|승용|택시|리무진|의전/],
];

/** categoryHint 가 없을 때 차종 문구에서 분류 추정. */
export const inferCategory = (vehicleType: string): VehicleCategory | null => {
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(vehicleType)) return cat;
  return null;
};

const COLOR_FAMILIES: Array<[string, RegExp]> = [
  ['검정', /검정|검은|블랙|black/i],
  ['흰색', /흰|하양|하얀|화이트|white/i],
  ['은색', /은색|실버|silver/i],
  ['회색', /회색|그레이|gr[ae]y|쥐색/i],
  ['빨강', /빨강|빨간|붉은|레드|red/i],
  ['파랑', /파랑|파란|푸른|블루|blue/i],
  ['노랑', /노랑|노란|옐로|yellow/i],
  ['초록', /초록|녹색|그린|green/i],
  ['주황', /주황|오렌지|orange/i],
  ['갈색', /갈색|브라운|brown/i],
];

export const colorFamily = (text: string | null | undefined): string | null => {
  if (!text) return null;
  for (const [name, re] of COLOR_FAMILIES) if (re.test(text)) return name;
  return null;
};

type NameMatch = { points: number; reason: string } | null;

const matchName = (hint: string | null, v: MatchableVehicle): NameMatch => {
  if (!hint) return null;
  const h = normalize(hint);
  if (h.length < 2) return null;
  const brand = normalize(v.brand);
  const model = normalize(v.model);
  const full = brand + model;
  if (h === full || h === model || (h.length >= 3 && (full.includes(h) || h.includes(full)))) {
    return { points: 50, reason: '차명이 대본과 일치' };
  }
  if (model.length >= 2 && h.includes(model)) return { points: 40, reason: '모델명 일치' };
  if (brand.length >= 2 && h.includes(brand)) return { points: 20, reason: '브랜드 일치' };
  return null;
};

const keywordMatch = (vehicleType: string, v: MatchableVehicle): boolean => {
  const desc = normalize(`${v.description} ${v.brand} ${v.model}`);
  return vehicleType
    .split(/\s+/)
    .map(normalize)
    .some((t) => t.length >= 2 && desc.includes(t));
};

/** 한 차량의 점수와 사유. 후보가 될 수 없으면 null. */
export function scoreVehicle(req: MatchableRequirement, v: MatchableVehicle): { score: number; reason: string } | null {
  const needsDamage = req.damageExpected || req.usage === Usage.DAMAGE;
  if (needsDamage && !v.damageAllowed) return null; // 파손 촬영 불가 차량은 제외

  let score = 0;
  const reasons: string[] = [];

  const wantCategory = req.categoryHint ?? inferCategory(req.vehicleType);
  const name = matchName(req.brandModelHint, v);
  if (name) {
    score += name.points;
    reasons.push(name.reason);
  }
  if (wantCategory && v.category === wantCategory) {
    score += 40;
    reasons.push(`분류(${CATEGORY_LABEL[wantCategory]}) 일치`);
  }
  const keyword = keywordMatch(req.vehicleType, v);
  if (keyword) {
    score += 5;
    if (!name && !(wantCategory && v.category === wantCategory)) reasons.push('차종 설명 키워드 일치');
  }
  if (score === 0) return null; // 아무 신호도 없으면 후보 아님

  const wantColor = colorFamily(`${req.sourceQuote ?? ''} ${req.brandModelHint ?? ''} ${req.vehicleType}`);
  if (wantColor && colorFamily(v.color) === wantColor) {
    score += 10;
    reasons.push(`색상(${wantColor}) 일치`);
  }
  if (needsDamage) {
    score += 10;
    reasons.push('파손 촬영 가능');
  }
  return { score: Math.min(100, score), reason: reasons.join(', ') };
}

/** AVAILABLE 차량만 넘겨야 한다. 점수 내림차순 → 일 단가 오름차순 → 이름순. 상위 5개. */
export function rankCandidates(
  req: MatchableRequirement,
  vehicles: MatchableVehicle[],
  limit = MAX_CANDIDATES,
): MatchResult[] {
  return vehicles
    .map((v) => ({ v, s: scoreVehicle(req, v) }))
    .filter((x): x is { v: MatchableVehicle; s: { score: number; reason: string } } => x.s !== null)
    .sort(
      (a, b) =>
        b.s.score - a.s.score ||
        a.v.dailyRate - b.v.dailyRate ||
        `${a.v.brand}${a.v.model}`.localeCompare(`${b.v.brand}${b.v.model}`, 'ko') ||
        a.v.id.localeCompare(b.v.id),
    )
    .slice(0, limit)
    .map((x, i) => ({ vehicleId: x.v.id, score: x.s.score, reason: x.s.reason, rank: i + 1 }));
}
