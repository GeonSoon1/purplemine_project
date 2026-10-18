import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { OptionalNotNull } from '../common/dto-helpers';
import { Role, Usage, VehicleCategory, values } from '../common/enums';

export class CreateRequirementDto {
  @IsUUID() sceneId: string;
  @IsIn(values(Role)) role: Role;
  @IsString() @Length(1, 100) vehicleType: string;
  @IsOptional() @IsIn(values(VehicleCategory)) categoryHint?: VehicleCategory | null;
  @IsOptional() @IsString() @Length(1, 100) brandModelHint?: string | null;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
  @IsIn(values(Usage)) usage: Usage;
  @IsOptional() @IsBoolean() damageExpected?: boolean;
  @IsOptional() @IsString() sourceQuote?: string | null;
}

export class UpdateRequirementDto {
  @OptionalNotNull() @IsIn(values(Role)) role?: Role;
  @OptionalNotNull() @IsString() @Length(1, 100) vehicleType?: string;
  @IsOptional() @IsIn(values(VehicleCategory)) categoryHint?: VehicleCategory | null;
  @IsOptional() @IsString() @Length(1, 100) brandModelHint?: string | null;
  @OptionalNotNull() @Type(() => Number) @IsInt() @Min(1) quantity?: number;
  @OptionalNotNull() @IsIn(values(Usage)) usage?: Usage;
  @OptionalNotNull() @IsBoolean() damageExpected?: boolean;
  @IsOptional() @IsString() sourceQuote?: string | null;
}

export class SelectionDto {
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) vehicleIds: string[];
}
