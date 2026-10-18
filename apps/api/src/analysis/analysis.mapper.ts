import type { MatchCandidate, Scene, ShootSchedule, VehicleRequirement } from '../entities';

export const toVehicleBrief = (v: NonNullable<MatchCandidate['vehicle']>) => ({
  id: v.id,
  plateNo: v.plateNo,
  brand: v.brand,
  model: v.model,
  year: v.year,
  category: v.category,
  color: v.color,
  dailyRate: v.dailyRate,
  damageAllowed: v.damageAllowed,
});

export const toCandidateDto = (c: MatchCandidate) => ({
  id: c.id,
  vehicleId: c.vehicleId,
  score: c.score,
  reason: c.reason,
  rank: c.rank,
  isSelected: c.isSelected,
  vehicle: toVehicleBrief(c.vehicle!),
});

export const toRequirementDto = (r: VehicleRequirement, sceneNo: number, candidates: MatchCandidate[]) => {
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank);
  return {
    id: r.id,
    sceneId: r.sceneId,
    sceneNo,
    role: r.role,
    vehicleType: r.vehicleType,
    categoryHint: r.categoryHint,
    brandModelHint: r.brandModelHint,
    quantity: r.quantity,
    usage: r.usage,
    damageExpected: r.damageExpected,
    sourceQuote: r.sourceQuote,
    confidence: r.confidence,
    isUserEdited: r.isUserEdited,
    selectedCount: sorted.filter((c) => c.isSelected).length,
    candidates: sorted.map(toCandidateDto),
  };
};

export type RequirementDto = ReturnType<typeof toRequirementDto>;

export const toSceneDto = (s: Scene, requirements: RequirementDto[]) => ({
  id: s.id,
  sceneNo: s.sceneNo,
  location: s.location,
  timeOfDay: s.timeOfDay,
  summary: s.summary ?? '',
  sourceText: s.sourceText,
  shootDateHint: s.shootDateHint,
  requirements,
});

export const normalizeSchedule = (s: ShootSchedule | null | undefined): ShootSchedule => ({
  start: s?.start ?? null,
  end: s?.end ?? null,
  hints: s?.hints ?? [],
});

export const summarize = (reqs: RequirementDto[]) => {
  let selectedCount = 0;
  let noCandidateCount = 0;
  for (const r of reqs) {
    if (r.selectedCount >= r.quantity) selectedCount++;
    else if (r.candidates.length === 0) noCandidateCount++;
  }
  return {
    requirementCount: reqs.length,
    selectedCount,
    noCandidateCount,
    pendingCount: reqs.length - selectedCount - noCandidateCount,
  };
};
