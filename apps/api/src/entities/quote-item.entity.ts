import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Role, Usage } from '../common/enums';
import { numericTransformer } from '../common/numeric.transformer';
import { Quote } from './quote.entity';
import { Vehicle } from './vehicle.entity';

@Entity('quote_items')
export class QuoteItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'quote_id', type: 'uuid' }) quoteId: string;
  @Column({ name: 'vehicle_id', type: 'uuid', nullable: true }) vehicleId: string | null;
  @Column({ name: 'requirement_id', type: 'uuid', nullable: true }) requirementId: string | null;
  @Column({ type: 'int', default: 0 }) position: number;
  @Column({ type: 'varchar', length: 200, nullable: true }) label: string | null;
  @Column({ type: 'varchar', length: 12, nullable: true }) role: Role | null;
  @Column({ name: 'usage', type: 'varchar', length: 10, nullable: true }) usage: Usage | null;
  @Column({ name: 'damage_expected', type: 'boolean', default: false }) damageExpected: boolean;
  @Column({ name: 'scene_nos', type: 'int', array: true, default: () => "'{}'" }) sceneNos: number[];
  @Column({ type: 'int', default: 1 }) quantity: number;
  @Column({ name: 'start_date', type: 'date', nullable: true }) startDate: string | null;
  @Column({ name: 'end_date', type: 'date', nullable: true }) endDate: string | null;
  @Column({ type: 'int', nullable: true }) days: number | null;
  @Column({ name: 'unit_price', type: 'numeric', precision: 12, scale: 0, default: 0, transformer: numericTransformer }) unitPrice: number;
  @Column({ name: 'extra_amount', type: 'numeric', precision: 12, scale: 0, default: 0, transformer: numericTransformer }) extraAmount: number;
  @Column({ type: 'numeric', precision: 14, scale: 0, default: 0, transformer: numericTransformer }) subtotal: number;
  @Column({ type: 'text', nullable: true }) memo: string | null;

  @ManyToOne(() => Quote, (q) => q.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote?: Quote;

  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle?: Vehicle | null;
}
