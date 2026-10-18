import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { addDays, todayUtc } from '../common/date';
import { QuoteStatus, ScriptStatus } from '../common/enums';
import { likePattern, Page, skipOf, toPage } from '../common/pagination';
import { MatchCandidate, Quote, QuoteItem, Scene, Script, Vehicle, VehicleRequirement } from '../entities';
import {
  CreateQuoteDto,
  CreateQuoteItemDto,
  ListQuotesQueryDto,
  SaveQuoteDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './dto';
import { calcTotals, itemDays, itemSubtotal } from './quote-calculator';
import { toQuoteDto, toQuoteListItemDto } from './quotes.mapper';

const LOCKED_STATUSES: QuoteStatus[] = [QuoteStatus.SENT, QuoteStatus.CONFIRMED];
const isUnique = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

@Injectable()
export class QuotesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(QuoteItem) private readonly items: Repository<QuoteItem>,
  ) {}

  // ───────────────────────── 생성 ─────────────────────────

  async create(dto: CreateQuoteDto) {
    const script = await this.dataSource.getRepository(Script).findOneBy({ id: dto.scriptId });
    if (!script) throw new NotFoundException('대본을 찾을 수 없습니다.');
    if (script.status !== ScriptStatus.ANALYZED) {
      throw new ConflictException('분석이 완료된 대본으로만 견적서를 만들 수 있습니다.');
    }

    const periodStart = dto.periodStart ?? script.shootStart ?? script.shootSchedule?.start ?? null;
    const periodEnd = dto.periodEnd ?? script.shootEnd ?? script.shootSchedule?.end ?? null;
    this.assertRange(periodStart, periodEnd, '견적 기간');

    const id = await this.dataSource.transaction(async (em) => {
      const quoteNo = await this.nextQuoteNo(em);
      const quote = await em.save(
        em.create(Quote, {
          scriptId: script.id,
          quoteNo,
          version: 1,
          status: QuoteStatus.DRAFT,
          title: script.title,
          productionCompany: script.productionCompany,
          periodStart,
          periodEnd,
          author: dto.author ?? null,
          validUntil: dto.validUntil ?? addDays(todayUtc(), 30),
          memo: null,
        }),
      );
      const items = await this.buildItemsFromSelection(em, quote);
      if (items.length) await em.insert(QuoteItem, items);
      await this.recalc(em, quote.id);
      return quote.id;
    });
    return this.get(id);
  }

  /** 선택된 후보 → 항목. 부족한 대수는 "차량 미정" 항목 1개로. */
  private async buildItemsFromSelection(em: EntityManager, quote: Quote): Promise<QuoteItem[]> {
    const rows = await em
      .createQueryBuilder(VehicleRequirement, 'r')
      .innerJoinAndMapOne('r.scene', Scene, 'sc', 'sc.id = r.scene_id')
      .where('sc.script_id = :sid', { sid: quote.scriptId })
      .orderBy('sc.scene_no', 'ASC')
      .addOrderBy('r.created_at', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getMany();
    if (!rows.length) return [];

    const selected = await em.find(MatchCandidate, {
      where: { requirementId: In(rows.map((r) => r.id)), isSelected: true },
      relations: { vehicle: true },
      order: { rank: 'ASC' },
    });
    const byReq = new Map<string, MatchCandidate[]>();
    for (const c of selected) byReq.set(c.requirementId, [...(byReq.get(c.requirementId) ?? []), c]);

    const out: QuoteItem[] = [];
    for (const r of rows) {
      const scene = r.scene!;
      const [startDate, endDate] = scene.shootDateHint
        ? [scene.shootDateHint, scene.shootDateHint]
        : [quote.periodStart, quote.periodEnd];
      const base = {
        quoteId: quote.id,
        requirementId: r.id,
        role: r.role,
        usage: r.usage,
        damageExpected: r.damageExpected,
        sceneNos: [scene.sceneNo],
        startDate,
        endDate,
        days: itemDays(startDate, endDate),
        extraAmount: 0,
        memo: null,
      };
      const chosen = (byReq.get(r.id) ?? []).slice(0, r.quantity);
      for (const c of chosen) {
        out.push(
          this.makeItem(out.length, {
            ...base,
            vehicleId: c.vehicleId,
            label: null,
            quantity: 1,
            unitPrice: c.vehicle!.dailyRate,
          }),
        );
      }
      const shortfall = r.quantity - chosen.length;
      if (shortfall > 0) {
        out.push(
          this.makeItem(out.length, {
            ...base,
            vehicleId: null,
            label: `${r.vehicleType} ${shortfall}대 필요`.slice(0, 200),
            quantity: shortfall,
            unitPrice: 0,
          }),
        );
      }
    }
    return out;
  }

  private makeItem(position: number, f: Omit<Partial<QuoteItem>, 'id' | 'position' | 'subtotal'>): QuoteItem {
    const item = Object.assign(new QuoteItem(), f, {
      id: randomUUID(),
      position,
    });
    item.subtotal = itemSubtotal(item.unitPrice ?? 0, item.quantity ?? 1, item.days ?? null, item.extraAmount ?? 0);
    return item;
  }

  /** Q-{연도}-{4자리}. 동시 생성 충돌은 advisory lock 으로 직렬화. */
  private async nextQuoteNo(em: EntityManager): Promise<string> {
    const year = new Date().getUTCFullYear();
    await em.query(`SELECT pg_advisory_xact_lock(hashtext('quote_no'))`);
    const [row] = await em.query<Array<{ max: number | null }>>(
      `SELECT MAX(substring(quote_no from 8)::int) AS max FROM quotes WHERE quote_no LIKE $1`,
      [`Q-${year}-%`],
    );
    return `Q-${year}-${String((row?.max ?? 0) + 1).padStart(4, '0')}`;
  }

  // ───────────────────────── 조회 ─────────────────────────

  async list(q: ListQuotesQueryDto): Promise<Page<ReturnType<typeof toQuoteListItemDto>>> {
    const qb = this.quotes.createQueryBuilder('q');
    if (q.status) qb.andWhere('q.status = :status', { status: q.status });
    if (q.scriptId) qb.andWhere('q.script_id = :sid', { sid: q.scriptId });
    if (q.q) {
      qb.andWhere(
        `(q.quote_no ILIKE :like ESCAPE '\\' OR q.title ILIKE :like ESCAPE '\\' OR q.production_company ILIKE :like ESCAPE '\\')`,
        { like: likePattern(q.q) },
      );
    }
    const [rows, total] = await qb
      .orderBy('q.createdAt', 'DESC')
      .addOrderBy('q.version', 'DESC')
      .addOrderBy('q.id', 'ASC')
      .skip(skipOf(q))
      .take(q.pageSize)
      .getManyAndCount();

    const latest = new Map<string, number>();
    const stats = new Map<string, { itemCount: number; unassignedCount: number }>();
    if (rows.length) {
      const maxRows = await this.quotes
        .createQueryBuilder('q')
        .select('q.quote_no', 'quoteNo')
        .addSelect('MAX(q.version)', 'v')
        .where('q.quote_no IN (:...nos)', {
          nos: [...new Set(rows.map((r) => r.quoteNo))],
        })
        .groupBy('q.quote_no')
        .getRawMany<{ quoteNo: string; v: number }>();
      for (const m of maxRows) latest.set(m.quoteNo, Number(m.v));

      const itemRows = await this.items
        .createQueryBuilder('i')
        .select('i.quote_id', 'quoteId')
        .addSelect('COUNT(*)', 'n')
        .addSelect('COUNT(*) FILTER (WHERE i.vehicle_id IS NULL)', 'u')
        .where('i.quote_id IN (:...ids)', { ids: rows.map((r) => r.id) })
        .groupBy('i.quote_id')
        .getRawMany<{ quoteId: string; n: string; u: string }>();
      for (const s of itemRows)
        stats.set(s.quoteId, {
          itemCount: Number(s.n),
          unassignedCount: Number(s.u),
        });
    }
    return toPage(
      rows.map((r) =>
        toQuoteListItemDto(r, {
          isLatest: latest.get(r.quoteNo) === r.version,
          itemCount: stats.get(r.id)?.itemCount ?? 0,
          unassignedCount: stats.get(r.id)?.unassignedCount ?? 0,
        }),
      ),
      q,
      total,
    );
  }

  async get(id: string, em: EntityManager = this.dataSource.manager) {
    const quote = await em.findOneBy(Quote, { id });
    if (!quote) throw new NotFoundException('견적서를 찾을 수 없습니다.');
    const items = await em.find(QuoteItem, {
      where: { quoteId: id },
      relations: { vehicle: true },
      order: { position: 'ASC', id: 'ASC' },
    });
    const { v } = (await em
      .createQueryBuilder(Quote, 'q')
      .select('MAX(q.version)', 'v')
      .where('q.quote_no = :no', { no: quote.quoteNo })
      .getRawOne<{ v: number }>())!;
    return toQuoteDto(quote, items, Number(v) === quote.version);
  }

  // ───────────────────────── 헤더 수정 ─────────────────────────

  async update(id: string, dto: UpdateQuoteDto) {
    await this.dataSource.transaction(async (em) => {
      const quote = await this.lock(em, id);
      await this.assertLatest(em, quote);
      await this.applyHeader(em, quote, dto);
    });
    return this.get(id);
  }

  /** 헤더 변경 적용 (잠금·최신 버전 검사는 호출 쪽 책임). */
  private async applyHeader(em: EntityManager, quote: Quote, dto: UpdateQuoteDto): Promise<void> {
    const touchesOther = (['periodStart', 'periodEnd', 'validUntil', 'author', 'memo'] as const).some(
      (k) => dto[k] !== undefined,
    );
    if (touchesOther && LOCKED_STATUSES.includes(quote.status)) {
      throw new ConflictException('발송/확정된 견적서는 수정할 수 없습니다. 새 버전을 만들어 수정하세요.');
    }
    const start = dto.periodStart !== undefined ? dto.periodStart : quote.periodStart;
    const end = dto.periodEnd !== undefined ? dto.periodEnd : quote.periodEnd;
    this.assertRange(start, end, '견적 기간');

    const patch: Partial<Quote> = {};
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.periodStart !== undefined) patch.periodStart = dto.periodStart;
    if (dto.periodEnd !== undefined) patch.periodEnd = dto.periodEnd;
    if (dto.validUntil !== undefined) patch.validUntil = dto.validUntil;
    if (dto.author !== undefined) patch.author = dto.author;
    if (dto.memo !== undefined) patch.memo = dto.memo;
    if (Object.keys(patch).length) await em.update(Quote, quote.id, patch);
  }

  /** 헤더 + 항목 추가/수정/삭제를 한 트랜잭션으로 저장. 하나라도 실패하면 아무것도 반영하지 않는다. */
  async save(id: string, dto: SaveQuoteDto) {
    await this.dataSource.transaction(async (em) => {
      const quote = await this.lock(em, id);
      await this.assertLatest(em, quote);

      const ch = dto.items;
      const touchesItems = !!(ch?.remove?.length || ch?.update?.length || ch?.add?.length);
      if (touchesItems) await this.assertEditable(em, quote);

      // 순서: 삭제 → 수정 → 추가 → 헤더 (헤더의 상태 변경은 항목 검사에 영향을 주지 않는다)
      for (const itemId of ch?.remove ?? []) await this.applyRemoveItem(em, id, itemId);
      for (const { id: itemId, ...patch } of ch?.update ?? []) await this.applyUpdateItem(em, id, itemId, patch);
      for (const item of ch?.add ?? []) await this.applyAddItem(em, quote, item);
      if (dto.header) await this.applyHeader(em, quote, dto.header);
      if (touchesItems) await this.recalc(em, id);
    });
    return this.get(id);
  }

  // ───────────────────────── 항목 ─────────────────────────

  async addItem(quoteId: string, dto: CreateQuoteItemDto) {
    await this.dataSource.transaction(async (em) => {
      const quote = await this.lock(em, quoteId);
      await this.assertEditable(em, quote);
      await this.applyAddItem(em, quote, dto);
      await this.recalc(em, quoteId);
    });
    return this.get(quoteId);
  }

  async updateItem(quoteId: string, itemId: string, dto: UpdateQuoteItemDto) {
    await this.dataSource.transaction(async (em) => {
      const quote = await this.lock(em, quoteId);
      await this.assertEditable(em, quote);
      await this.applyUpdateItem(em, quoteId, itemId, dto);
      await this.recalc(em, quoteId);
    });
    return this.get(quoteId);
  }

  async removeItem(quoteId: string, itemId: string) {
    await this.dataSource.transaction(async (em) => {
      const quote = await this.lock(em, quoteId);
      await this.assertEditable(em, quote);
      await this.applyRemoveItem(em, quoteId, itemId);
      await this.recalc(em, quoteId);
    });
    return this.get(quoteId);
  }

  // 아래 apply* 는 잠금·편집 가능 검사·합계 재계산을 호출 쪽에서 한다고 가정한다.

  private async applyAddItem(em: EntityManager, quote: Quote, dto: CreateQuoteItemDto): Promise<void> {
    const quoteId = quote.id;
    let vehicle: Vehicle | null = null;
    if (dto.vehicleId) vehicle = await this.findVehicle(em, dto.vehicleId);
    else if (!dto.label) throw new BadRequestException('vehicleId 가 없으면 label 이 필요합니다 (차량 미정 항목).');

    const startDate = dto.startDate !== undefined ? dto.startDate : quote.periodStart;
    const endDate = dto.endDate !== undefined ? dto.endDate : quote.periodEnd;
    this.assertRange(startDate, endDate, '항목 기간');

    const [{ max }] = await em.query<Array<{ max: number | null }>>(
      `SELECT MAX(position) AS max FROM quote_items WHERE quote_id = $1`,
      [quoteId],
    );
    const item = this.makeItem((max ?? -1) + 1, {
      quoteId,
      vehicleId: vehicle?.id ?? null,
      requirementId: null,
      label: dto.label ?? null,
      role: dto.role ?? null,
      usage: dto.usage ?? null,
      damageExpected: dto.damageExpected ?? false,
      sceneNos: dto.sceneNos ?? [],
      quantity: dto.quantity,
      startDate,
      endDate,
      days: itemDays(startDate, endDate),
      unitPrice: dto.unitPrice ?? vehicle?.dailyRate ?? 0,
      extraAmount: dto.extraAmount ?? 0,
      memo: dto.memo ?? null,
    });
    await em.insert(QuoteItem, item);
  }

  private async applyUpdateItem(
    em: EntityManager,
    quoteId: string,
    itemId: string,
    dto: UpdateQuoteItemDto,
  ): Promise<void> {
    const item = await em.findOneBy(QuoteItem, { id: itemId, quoteId });
    if (!item) throw new NotFoundException('견적서 항목을 찾을 수 없습니다.');

    if (dto.vehicleId !== undefined) {
      if (dto.vehicleId === null) {
        item.vehicleId = null;
      } else {
        const vehicle = await this.findVehicle(em, dto.vehicleId);
        item.vehicleId = vehicle.id;
        if (dto.unitPrice === undefined) item.unitPrice = vehicle.dailyRate;
      }
    }
    if (dto.label !== undefined) item.label = dto.label;
    if (item.vehicleId === null && !item.label) {
      throw new BadRequestException('차량 미정 항목에는 label 이 필요합니다.');
    }
    if (dto.role !== undefined) item.role = dto.role;
    if (dto.usage !== undefined) item.usage = dto.usage;
    if (dto.damageExpected !== undefined) item.damageExpected = dto.damageExpected;
    if (dto.quantity !== undefined) item.quantity = dto.quantity;
    if (dto.startDate !== undefined) item.startDate = dto.startDate;
    if (dto.endDate !== undefined) item.endDate = dto.endDate;
    if (dto.unitPrice !== undefined) item.unitPrice = dto.unitPrice;
    if (dto.extraAmount !== undefined) item.extraAmount = dto.extraAmount;
    if (dto.memo !== undefined) item.memo = dto.memo;
    if (dto.sceneNos !== undefined) item.sceneNos = dto.sceneNos;

    this.assertRange(item.startDate, item.endDate, '항목 기간');
    item.days = itemDays(item.startDate, item.endDate);
    item.subtotal = itemSubtotal(item.unitPrice, item.quantity, item.days, item.extraAmount);

    const { vehicle: _ignored, quote: _q, ...columns } = item;
    await em.update(QuoteItem, item.id, columns);
  }

  private async applyRemoveItem(em: EntityManager, quoteId: string, itemId: string): Promise<void> {
    const res = await em.delete(QuoteItem, { id: itemId, quoteId });
    if (!res.affected) throw new NotFoundException('견적서 항목을 찾을 수 없습니다.');
  }

  // ───────────────────────── 새 버전 ─────────────────────────

  async revise(id: string) {
    let newId: string;
    try {
      newId = await this.dataSource.transaction(async (em) => {
        const src = await this.lock(em, id);
        await this.assertLatest(em, src);
        const srcItems = await em.find(QuoteItem, {
          where: { quoteId: id },
          order: { position: 'ASC', id: 'ASC' },
        });

        const { id: _id, createdAt: _c, updatedAt: _u, items: _i, ...header } = src;
        const copy = await em.save(
          em.create(Quote, {
            ...header,
            version: src.version + 1,
            status: QuoteStatus.DRAFT,
          }),
        );
        if (srcItems.length) {
          await em.insert(
            QuoteItem,
            srcItems.map((i) => {
              const { vehicle: _v, quote: _q, ...cols } = i;
              return { ...cols, id: randomUUID(), quoteId: copy.id };
            }),
          );
        }
        return copy.id;
      });
    } catch (e) {
      if (isUnique(e))
        throw new ConflictException('다른 요청이 먼저 새 버전을 만들었습니다. 새로고침 후 다시 시도하세요.');
      throw e;
    }
    return this.get(newId);
  }

  // ───────────────────────── 공통 ─────────────────────────

  /** 헤더 행 잠금 (항목 편집/합계 재계산 직렬화). */
  private async lock(em: EntityManager, id: string): Promise<Quote> {
    const quote = await em.findOne(Quote, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!quote) throw new NotFoundException('견적서를 찾을 수 없습니다.');
    return quote;
  }

  private async assertLatest(em: EntityManager, quote: Quote): Promise<void> {
    const newer = await em
      .createQueryBuilder(Quote, 'q')
      .where('q.quote_no = :no AND q.version > :v', {
        no: quote.quoteNo,
        v: quote.version,
      })
      .getExists();
    if (newer) throw new ConflictException('최신 버전이 아닌 견적서는 수정할 수 없습니다.');
  }

  /** 항목 편집: 최신 버전이고 SENT/CONFIRMED 가 아니어야 한다. */
  private async assertEditable(em: EntityManager, quote: Quote): Promise<void> {
    if (LOCKED_STATUSES.includes(quote.status)) {
      throw new ConflictException('발송/확정된 견적서는 수정할 수 없습니다. 새 버전을 만들어 수정하세요.');
    }
    await this.assertLatest(em, quote);
  }

  private assertRange(start: string | null, end: string | null, what: string): void {
    if (start && end && end < start) throw new BadRequestException(`${what}의 종료일은 시작일 이후여야 합니다.`);
  }

  private async findVehicle(em: EntityManager, id: string): Promise<Vehicle> {
    const v = await em.findOneBy(Vehicle, { id });
    if (!v) throw new NotFoundException('차량을 찾을 수 없습니다.');
    return v;
  }

  /** 항목 소계 합으로 공급가액/부가세/합계 갱신. */
  private async recalc(em: EntityManager, quoteId: string): Promise<void> {
    const rows = await em.find(QuoteItem, {
      where: { quoteId },
      select: { id: true, subtotal: true },
    });
    await em.update(Quote, quoteId, calcTotals(rows.map((r) => r.subtotal)));
  }
}
