import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TimeOfDay } from '../common/enums';
import { Script } from './script.entity';
import type { VehicleRequirement } from './vehicle-requirement.entity';

@Entity('scenes')
export class Scene {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'script_id', type: 'uuid' }) scriptId: string;
  @Column({ name: 'scene_no', type: 'int' }) sceneNo: number;
  @Column({ type: 'varchar', length: 200, nullable: true }) location: string | null;
  @Column({ name: 'time_of_day', type: 'varchar', length: 10, default: TimeOfDay.UNKNOWN }) timeOfDay: TimeOfDay;
  @Column({ type: 'text', nullable: true }) summary: string | null;
  @Column({ name: 'source_text', type: 'text', default: '' }) sourceText: string;
  @Column({ name: 'shoot_date_hint', type: 'date', nullable: true }) shootDateHint: string | null;

  @ManyToOne(() => Script, (s) => s.scenes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'script_id' })
  script?: Script;

  @OneToMany('VehicleRequirement', 'scene') requirements?: VehicleRequirement[];
}
