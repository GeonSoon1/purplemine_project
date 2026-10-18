import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { EmptyToUndefined, IsIsoDate } from '../common/date';
import { PaginationQueryDto } from '../common/pagination';
import { ScriptStatus, values } from '../common/enums';

export class CreateScriptDto {
  @IsString() @Length(1, 200) title: string;
  @IsString() @Length(1, 200) productionCompany: string;
  @EmptyToUndefined() @IsOptional() @IsIsoDate() shootStart?: string;
  @EmptyToUndefined() @IsOptional() @IsIsoDate() shootEnd?: string;
}

export class ListScriptsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(values(ScriptStatus)) status?: ScriptStatus;
  @IsOptional() @IsString() @Length(1, 100) q?: string;
}
