import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleCategory, VehicleStatus, values } from '../common/enums';
import { likePattern, Page, skipOf, toPage } from '../common/pagination';
import { QuoteItem, Vehicle } from '../entities';
import { CATEGORY_LABEL } from '../matching/matching';
import { embeddingText, VehicleEmbeddingService } from './vehicle-embedding.service';
import { CreateVehicleDto, ListVehiclesQueryDto, UpdateVehicleDto } from './dto';

export const toVehicleDto = (v: Vehicle) => ({
  id: v.id,
  plateNo: v.plateNo,
  brand: v.brand,
  model: v.model,
  year: v.year,
  category: v.category,
  color: v.color,
  seats: v.seats,
  dailyRate: v.dailyRate,
  damageAllowed: v.damageAllowed,
  status: v.status,
  description: v.description,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
});

/** 설명 자동 생성: "제네시스 G90 2023년식 검정 세단". 임베딩/매칭 원문으로 쓰인다. */
export const generateDescription = (v: Pick<Vehicle, 'brand' | 'model' | 'year' | 'color' | 'category'>): string =>
  [v.brand, v.model, `${v.year}년식`, v.color, CATEGORY_LABEL[v.category]].filter(Boolean).join(' ');

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string })?.code === '23505';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(QuoteItem) private readonly items: Repository<QuoteItem>,
    private readonly embeddings: VehicleEmbeddingService,
  ) {}

  async list(q: ListVehiclesQueryDto): Promise<Page<ReturnType<typeof toVehicleDto>>> {
    const qb = this.vehicles.createQueryBuilder('v');
    if (q.q) {
      qb.andWhere(
        `(v.plate_no ILIKE :like ESCAPE '\\' OR v.brand ILIKE :like ESCAPE '\\' OR v.model ILIKE :like ESCAPE '\\' OR v.color ILIKE :like ESCAPE '\\')`,
        { like: likePattern(q.q) },
      );
    }
    if (q.category) qb.andWhere('v.category = :category', { category: q.category });
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.damageAllowed !== undefined) qb.andWhere('v.damage_allowed = :da', { da: q.damageAllowed });
    const [rows, total] = await qb
      .orderBy('v.brand', 'ASC')
      .addOrderBy('v.model', 'ASC')
      .addOrderBy('v.year', 'DESC')
      .addOrderBy('v.id', 'ASC')
      .skip(skipOf(q))
      .take(q.pageSize)
      .getManyAndCount();
    return toPage(rows.map(toVehicleDto), q, total);
  }

  async summary() {
    const rows = await this.vehicles
      .createQueryBuilder('v')
      .select('v.category', 'category')
      .addSelect('COUNT(*)', 'n')
      .where('v.status = :s', { s: VehicleStatus.AVAILABLE })
      .groupBy('v.category')
      .getRawMany<{ category: VehicleCategory; n: string }>();
    const byCategory = Object.fromEntries(values(VehicleCategory).map((c) => [c, 0])) as Record<VehicleCategory, number>;
    let total = 0;
    for (const r of rows) {
      byCategory[r.category] = Number(r.n);
      total += Number(r.n);
    }
    return { total, byCategory };
  }

  async get(id: string) {
    return toVehicleDto(await this.find(id));
  }

  async create(dto: CreateVehicleDto) {
    const plateNo = dto.plateNo.trim();
    const entity = this.vehicles.create({
      plateNo,
      brand: dto.brand,
      model: dto.model,
      year: dto.year,
      category: dto.category,
      dailyRate: dto.dailyRate,
      color: dto.color ?? null,
      seats: dto.seats ?? null,
      damageAllowed: dto.damageAllowed ?? false,
      status: dto.status ?? VehicleStatus.AVAILABLE,
    });
    entity.description = dto.description?.trim() || generateDescription(entity);
    const saved = await this.saveUnique(entity);
    await this.embeddings.embedVehicle(saved); // 실패해도 등록은 성공 (embedding null 유지)
    return toVehicleDto(saved);
  }

  async update(id: string, dto: UpdateVehicleDto) {
    const v = await this.find(id);
    const prevText = embeddingText(v);
    const wasAuto = v.description === generateDescription(v);

    const keys = ['plateNo', 'brand', 'model', 'year', 'category', 'dailyRate', 'color', 'seats', 'damageAllowed', 'status'] as const;
    let descriptiveChanged = false;
    for (const k of keys) {
      if (dto[k] === undefined) continue;
      const next = typeof dto[k] === 'string' ? (dto[k] as string).trim() : dto[k];
      if (next !== v[k] && ['brand', 'model', 'year', 'category', 'color'].includes(k)) descriptiveChanged = true;
      (v as unknown as Record<string, unknown>)[k] = next;
    }
    if (dto.description !== undefined) v.description = dto.description?.trim() || generateDescription(v);
    else if (descriptiveChanged && wasAuto) v.description = generateDescription(v);

    const saved = await this.saveUnique(v);
    if (embeddingText(saved) !== prevText) {
      await this.embeddings.clear(saved.id); // 재임베딩이 실패해도 낡은 벡터가 남지 않게
      await this.embeddings.embedVehicle(saved);
    }
    return toVehicleDto(saved);
  }

  async remove(id: string): Promise<void> {
    await this.find(id);
    if (await this.items.existsBy({ vehicleId: id })) {
      throw new ConflictException('견적서에서 사용 중인 차량은 삭제할 수 없습니다. 상태를 INACTIVE 로 바꾸세요.');
    }
    try {
      await this.vehicles.delete({ id });
    } catch (e) {
      if ((e as { code?: string })?.code === '23503') {
        throw new ConflictException('견적서에서 사용 중인 차량은 삭제할 수 없습니다. 상태를 INACTIVE 로 바꾸세요.');
      }
      throw e;
    }
  }

  private async find(id: string): Promise<Vehicle> {
    const v = await this.vehicles.findOneBy({ id });
    if (!v) throw new NotFoundException('차량을 찾을 수 없습니다.');
    return v;
  }

  private async saveUnique(v: Vehicle): Promise<Vehicle> {
    try {
      return await this.vehicles.save(v);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('이미 등록된 차량번호입니다.');
      throw e;
    }
  }
}
