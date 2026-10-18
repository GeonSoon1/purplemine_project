import { Module } from '@nestjs/common';
import { ScriptFileService } from './script-file.service';

@Module({ providers: [ScriptFileService], exports: [ScriptFileService] })
export class FilesModule {}
