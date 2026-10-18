import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { VehicleCategory, VehicleStatus } from '../common/enums';
import { numericTransformer } from '../common/numeric.transformer';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'plate_no', type: 'varchar', length: 20, unique: true }) plateNo: string;
  @Column({ type: 'varchar', length: 50 }) brand: string;
  @Column({ type: 'varchar', length: 100 }) model: string;
  @Column({ type: 'smallint' }) year: number;
  @Column({ type: 'varchar', length: 10 }) category: VehicleCategory;
  @Column({ type: 'varchar', length: 30, nullable: true }) color: string | null;
  @Column({ type: 'smallint', nullable: true }) seats: number | null;
  @Column({ name: 'daily_rate', type: 'numeric', precision: 12, scale: 0, transformer: numericTransformer }) dailyRate: number;
  @Column({ name: 'damage_allowed', type: 'boolean', default: false }) damageAllowed: boolean;
  @Column({ type: 'varchar', length: 12, default: VehicleStatus.AVAILABLE }) status: VehicleStatus;
  @Column({ type: 'text', default: '' }) description: string;
  // embedding vector(384), embedding_model 컬럼은 마이그레이션에만 있고 VehicleEmbeddingService 가 raw SQL 로 다룬다 (응답/조회에서 제외).
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
