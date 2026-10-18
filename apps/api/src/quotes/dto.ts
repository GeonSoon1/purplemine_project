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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsIsoDate } from '../common/date';
import { OptionalNotNull } from '../common/dto-helpers';
import { QuoteStatus, Role, Usage, values } from '../common/enums';
import { PaginationQueryDto } from '../common/pagination';

const MAX_MONEY = 10_000_000_000;

export class CreateQuoteDto {
  @IsUUID() scriptId: string;
  @IsOptional() @IsString() @Length(1, 100) author?: string | null;
  @IsOptional() @IsIsoDate() validUntil?: string | null;
  @IsOptional() @IsIsoDate() periodStart?: string | null;
  @IsOptional() @IsIsoDate() periodEnd?: string | null;
}

export class UpdateQuoteDto {
  @OptionalNotNull() @IsIn(values(QuoteStatus)) status?: QuoteStatus;
  @IsOptional() @IsIsoDate() periodStart?: string | null;
  @IsOptional() @IsIsoDate() periodEnd?: string | null;
  @IsOptional() @IsIsoDate() validUntil?: string | null;
  @IsOptional() @IsString() @Length(1, 100) author?: string | null;
  @IsOptional() @IsString() memo?: string | null;
}

export class ListQuotesQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(values(QuoteStatus)) status?: QuoteStatus;
  @IsOptional() @IsUUID() scriptId?: string;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
}

export class CreateQuoteItemDto {
  @IsOptional() @IsUUID() vehicleId?: string | null;
  @IsOptional() @IsString() @Length(1, 200) label?: string | null;
  @IsOptional() @IsIn(values(Role)) role?: Role | null;
  @IsOptional() @IsIn(values(Usage)) usage?: Usage | null;
  @IsOptional() @IsBoolean() damageExpected?: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_000) quantity: number;
  @IsOptional() @IsIsoDate() startDate?: string | null;
  @IsOptional() @IsIsoDate() endDate?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  extraAmount?: number;
  @IsOptional() @IsString() memo?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(0, { each: true })
  sceneNos?: number[];
}

export class UpdateQuoteItemDto {
  @IsOptional() @IsUUID() vehicleId?: string | null;
  @IsOptional() @IsString() @Length(1, 200) label?: string | null;
  @IsOptional() @IsIn(values(Role)) role?: Role | null;
  @IsOptional() @IsIn(values(Usage)) usage?: Usage | null;
  @OptionalNotNull() @IsBoolean() damageExpected?: boolean;
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity?: number;
  @IsOptional() @IsIsoDate() startDate?: string | null;
  @IsOptional() @IsIsoDate() endDate?: string | null;
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice?: number;
  @OptionalNotNull()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  extraAmount?: number;
  @IsOptional() @IsString() memo?: string | null;
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(500)
  @IsInt({ each: true })
  @Min(0, { each: true })
  sceneNos?: number[];
}

export class UpdateQuoteItemWithIdDto extends UpdateQuoteItemDto {
  @IsUUID() id: string;
}

export class QuoteItemChangesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreateQuoteItemDto)
  add?: CreateQuoteItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => UpdateQuoteItemWithIdDto)
  update?: UpdateQuoteItemWithIdDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  remove?: string[];
}

/** 헤더 + 항목 변경을 한 번에 저장 (전부 반영되거나 전부 반영 안 됨). */
export class SaveQuoteDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateQuoteDto)
  header?: UpdateQuoteDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteItemChangesDto)
  items?: QuoteItemChangesDto;
}
