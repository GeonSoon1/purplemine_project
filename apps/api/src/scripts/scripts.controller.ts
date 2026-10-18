import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_SCRIPT_BYTES } from '../files/script-file.service';
import { CreateScriptDto, ListScriptsQueryDto } from './dto';
import { ScriptsService } from './scripts.service';

@Controller('scripts')
export class ScriptsController {
  constructor(private readonly scripts: ScriptsService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_SCRIPT_BYTES, files: 1 } }),
  )
  create(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: CreateScriptDto) {
    return this.scripts.create(file, dto);
  }

  @Get()
  list(@Query() q: ListScriptsQueryDto) {
    return this.scripts.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.scripts.get(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.scripts.remove(id);
  }

  @Post(':id/analyze')
  @HttpCode(202)
  analyze(@Param('id', ParseUUIDPipe) id: string) {
    return this.scripts.reanalyze(id);
  }
}
