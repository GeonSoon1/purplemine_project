import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Role, Usage, VehicleCategory } from '../common/enums';
import { Scene } from './scene.entity';
import type { MatchCandidate } from './match-candidate.entity';

@Entity('vehicle_requirements')
export class VehicleRequirement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'scene_id', type: 'uuid' }) sceneId: string;
  @Column({ type: 'varchar', length: 12 }) role: Role;
  @Column({ name: 'vehicle_type', type: 'varchar', length: 100 }) vehicleType: string;
  @Column({ name: 'category_hint', type: 'varchar', length: 10, nullable: true }) categoryHint: VehicleCategory | null;
  @Column({ name: 'brand_model_hint', type: 'varchar', length: 100, nullable: true }) brandModelHint: string | null;
  @Column({ type: 'int', default: 1 }) quantity: number;
  @Column({ name: 'usage', type: 'varchar', length: 10, default: Usage.NORMAL }) usage: Usage;
  @Column({ name: 'damage_expected', type: 'boolean', default: false }) damageExpected: boolean;
  @Column({ name: 'source_quote', type: 'text', nullable: true }) sourceQuote: string | null;
  @Column({ type: 'real', nullable: true }) confidence: number | null;
  @Column({ name: 'is_user_edited', type: 'boolean', default: false }) isUserEdited: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => Scene, (s) => s.requirements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scene_id' })
  scene?: Scene;

  @OneToMany('MatchCandidate', 'requirement') candidates?: MatchCandidate[];
}
