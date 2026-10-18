import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { QuoteStatus } from '../common/enums';
import { numericTransformer } from '../common/numeric.transformer';
import { QuoteItem } from './quote-item.entity';

@Entity('quotes')
export class Quote {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'script_id', type: 'uuid', nullable: true }) scriptId: string | null;
  @Column({ name: 'quote_no', type: 'varchar', length: 20 }) quoteNo: string;
  @Column({ type: 'int', default: 1 }) version: number;
  @Column({ type: 'varchar', length: 10, default: QuoteStatus.DRAFT }) status: QuoteStatus;
  @Column({ type: 'varchar', length: 200 }) title: string;
  @Column({ name: 'production_company', type: 'varchar', length: 200 }) productionCompany: string;
  @Column({ name: 'period_start', type: 'date', nullable: true }) periodStart: string | null;
  @Column({ name: 'period_end', type: 'date', nullable: true }) periodEnd: string | null;
  @Column({ name: 'supply_amount', type: 'numeric', precision: 14, scale: 0, default: 0, transformer: numericTransformer }) supplyAmount: number;
  @Column({ name: 'tax_amount', type: 'numeric', precision: 14, scale: 0, default: 0, transformer: numericTransformer }) taxAmount: number;
  @Column({ name: 'total_amount', type: 'numeric', precision: 14, scale: 0, default: 0, transformer: numericTransformer }) totalAmount: number;
  @Column({ type: 'varchar', length: 100, nullable: true }) author: string | null;
  @Column({ name: 'valid_until', type: 'date', nullable: true }) validUntil: string | null;
  @Column({ type: 'text', nullable: true }) memo: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;

  @OneToMany(() => QuoteItem, (i) => i.quote) items?: QuoteItem[];
}
