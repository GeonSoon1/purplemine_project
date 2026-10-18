import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { OptionalNotNull } from '../common/dto-helpers';
import { VehicleCategory, VehicleStatus, values } from '../common/enums';
import { PaginationQueryDto, ToBoolean } from '../common/pagination';

export class CreateVehicleDto {
  @IsString() @Length(1, 20) plateNo: string;
  @IsString() @Length(1, 50) brand: string;
  @IsString() @Length(1, 100) model: string;
  @Type(() => Number) @IsInt() @Min(1900) @Max(2100) year: number;
  @IsIn(values(VehicleCategory)) category: VehicleCategory;
  @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) dailyRate: number;
  @IsOptional() @IsString() @Length(1, 30) color?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) seats?: number | null;
  @IsOptional() @IsBoolean() damageAllowed?: boolean;
  @IsOptional() @IsIn(values(VehicleStatus)) status?: VehicleStatus;
  @IsOptional() @IsString() @Length(0, 2000) description?: string | null;
}

export class UpdateVehicleDto {
  @OptionalNotNull() @IsString() @Length(1, 20) plateNo?: string;
  @OptionalNotNull() @IsString() @Length(1, 50) brand?: string;
  @OptionalNotNull() @IsString() @Length(1, 100) model?: string;
  @OptionalNotNull() @Type(() => Number) @IsInt() @Min(1900) @Max(2100) year?: number;
  @OptionalNotNull() @IsIn(values(VehicleCategory)) category?: VehicleCategory;
  @OptionalNotNull() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000) dailyRate?: number;
  @IsOptional() @IsString() @Length(1, 30) color?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) seats?: number | null;
  @OptionalNotNull() @IsBoolean() damageAllowed?: boolean;
  @OptionalNotNull() @IsIn(values(VehicleStatus)) status?: VehicleStatus;
  @IsOptional() @IsString() @Length(0, 2000) description?: string | null;
}

export class ListVehiclesQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @IsOptional() @IsIn(values(VehicleCategory)) category?: VehicleCategory;
  @IsOptional() @IsIn(values(VehicleStatus)) status?: VehicleStatus;
  @IsOptional() @ToBoolean() @IsBoolean() damageAllowed?: boolean;
}
