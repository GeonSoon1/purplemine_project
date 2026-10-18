import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { MANUAL_CANDIDATE_REASON } from '../common/enums';
import { MatchCandidate, Scene, Script, Vehicle, VehicleRequirement } from '../entities';
import { CandidateMatcher } from '../matching/candidate-matcher.service';
import { inferCategory, MatchResult } from '../matching/matching';
import { AnalysisService } from './analysis.service';
import { CreateRequirementDto, SelectionDto, UpdateRequirementDto } from './dto';

/** 차종 관련 필드가 바뀌면 후보가 낡은 것이 된다. */
const MATCH_FIELDS = ['vehicleType', 'categoryHint', 'brandModelHint', 'usage', 'damageExpected'] as const;

@Injectable()
export class RequirementsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Script) private readonly scripts: Repository<Script>,
    @InjectRepository(Scene) private readonly scenes: Repository<Scene>,
    @InjectRepository(VehicleRequirement) private readonly reqs: Repository<VehicleRequirement>,
    private readonly analysis: AnalysisService,
    private readonly matcher: CandidateMatcher,
  ) {}

  async create(scriptId: string, dto: CreateRequirementDto) {
    if (!(await this.scripts.existsBy({ id: scriptId }))) throw new NotFoundException('대본을 찾을 수 없습니다.');
    const scene = await this.scenes.findOneBy({ id: dto.sceneId, scriptId });
    if (!scene) throw new NotFoundException('이 대본에서 해당 씬을 찾을 수 없습니다.');

    const draft = this.reqs.create({
      id: randomUUID(),
      sceneId: scene.id,
      role: dto.role,
      vehicleType: dto.vehicleType,
      categoryHint: dto.categoryHint ?? null,
      brandModelHint: dto.brandModelHint ?? null,
      quantity: dto.quantity,
      usage: dto.usage,
      damageExpected: dto.damageExpected ?? false,
      sourceQuote: dto.sourceQuote ?? null,
      confidence: null,
      isUserEdited: true,
    });
    // 외부 HTTP(/match)는 트랜잭션 밖에서 먼저 수행
    const { results } = await this.matcher.match(draft);
    await this.dataSource.transaction(async (em) => {
      await em.save(draft);
      await this.recompute(em, draft, new Set(), results);
    });
    return this.analysis.getRequirementDto(draft.id);
  }

  async update(id: string, dto: UpdateRequirementDto) {
    const req = await this.reqs.findOneBy({ id });
    if (!req) throw new NotFoundException('요구사항을 찾을 수 없습니다.');

    // 차종 문구만 바뀌고 분류를 안 보냈으면, 낡은 분류가 남지 않도록 문구에서 다시 추정한다 (못 찾으면 null)
    if (dto.vehicleType !== undefined && dto.vehicleType !== req.vehicleType && dto.categoryHint === undefined) {
      dto = { ...dto, categoryHint: inferCategory(dto.vehicleType) };
    }
    let stale = false;
    for (const key of MATCH_FIELDS) {
      if (dto[key] !== undefined && dto[key] !== req[key]) stale = true;
    }
    const fields = ['role', 'quantity', 'sourceQuote', ...MATCH_FIELDS] as const;
    for (const key of fields) {
      if (dto[key] !== undefined) (req as unknown as Record<string, unknown>)[key] = dto[key];
    }
    req.isUserEdited = true;
    await this.reqs.save(req);

    const out = await this.analysis.getRequirementDto(id);
    return stale ? { ...out, candidatesStale: true } : out;
  }

  async remove(id: string): Promise<void> {
    const res = await this.reqs.delete({ id });
    if (!res.affected) throw new NotFoundException('요구사항을 찾을 수 없습니다.');
  }

  /** 후보 다시 계산. 선택은 새 후보에 있을 때만 유지, "직접 선택" 후보는 유지. */
  async rematch(id: string) {
    const req = await this.reqs.findOneBy({ id });
    if (!req) throw new NotFoundException('요구사항을 찾을 수 없습니다.');
    const { results } = await this.matcher.match(req); // 트랜잭션 밖
    await this.dataSource.transaction(async (em) => {
      const old = await em.find(MatchCandidate, { where: { requirementId: id } });
      const keep = new Set(old.filter((c) => c.isSelected).map((c) => c.vehicleId));
      await this.recompute(em, req, keep, results, old);
    });
    return this.analysis.getRequirementDto(id);
  }

  async setSelection(id: string, dto: SelectionDto) {
    const req = await this.reqs.findOneBy({ id });
    if (!req) throw new NotFoundException('요구사항을 찾을 수 없습니다.');
    const wanted = [...new Set(dto.vehicleIds)];
    if (wanted.length > req.quantity) {
      throw new BadRequestException(`필요 대수(${req.quantity}대)보다 많이 선택할 수 없습니다.`);
    }

    await this.dataSource.transaction(async (em) => {
      if (wanted.length) {
        const found = await em.find(Vehicle, { where: { id: In(wanted) }, select: { id: true } });
        if (found.length !== wanted.length) throw new NotFoundException('존재하지 않는 차량이 포함되어 있습니다.');
      }
      const cands = await em.find(MatchCandidate, { where: { requirementId: id } });
      const want = new Set(wanted);
      const present = new Set(cands.map((c) => c.vehicleId));
      let nextRank = cands.reduce((m, c) => Math.max(m, c.rank), 0) + 1;

      for (const c of cands) {
        const selected = want.has(c.vehicleId);
        if (!selected && c.reason === MANUAL_CANDIDATE_REASON) await em.delete(MatchCandidate, c.id);
        else if (c.isSelected !== selected) await em.update(MatchCandidate, c.id, { isSelected: selected });
      }
      for (const vehicleId of wanted) {
        if (present.has(vehicleId)) continue;
        await em.insert(MatchCandidate, {
          requirementId: id,
          vehicleId,
          score: 0,
          reason: MANUAL_CANDIDATE_REASON,
          rank: nextRank++,
          isSelected: true,
        });
      }
    });
    return this.analysis.getRequirementDto(id);
  }

  /**
   * 후보 재계산 후 교체. keepSelected 에 있는 차량이 새 후보에 있으면 선택 유지.
   * old 로 넘긴 기존 후보 중 "직접 선택" 후보는 새 후보 뒤에 이어 붙인다.
   */
  private async recompute(
    em: EntityManager,
    req: VehicleRequirement,
    keepSelected: Set<string>,
    ranked: MatchResult[],
    old: MatchCandidate[] = [],
  ): Promise<void> {
    const manual = old.filter((c) => c.reason === MANUAL_CANDIDATE_REASON);
    const rankedIds = new Set(ranked.map((r) => r.vehicleId));

    await em.delete(MatchCandidate, { requirementId: req.id });
    const rows = ranked.map((r) =>
      em.create(MatchCandidate, {
        requirementId: req.id,
        vehicleId: r.vehicleId,
        score: r.score,
        reason: r.reason,
        rank: r.rank,
        isSelected: keepSelected.has(r.vehicleId),
      }),
    );
    let rank = ranked.length + 1;
    for (const m of manual) {
      if (rankedIds.has(m.vehicleId)) continue;
      rows.push(
        em.create(MatchCandidate, {
          requirementId: req.id,
          vehicleId: m.vehicleId,
          score: 0,
          reason: MANUAL_CANDIDATE_REASON,
          rank: rank++,
          isSelected: m.isSelected,
        }),
      );
    }
    if (rows.length) await em.insert(MatchCandidate, rows);
  }
}
