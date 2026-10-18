import { BadRequestException, Injectable, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AppConfig } from '../config/app.config';

export const ALLOWED_EXTENSIONS = ['txt', 'pdf', 'docx'] as const;
export type ScriptFileType = (typeof ALLOWED_EXTENSIONS)[number];
export const MAX_SCRIPT_BYTES = 10 * 1024 * 1024;
export const MAX_SCRIPT_CHARS = 500_000;

export const fileTypeOf = (originalName: string): ScriptFileType => {
  const ext = extname(originalName).slice(1).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UnsupportedMediaTypeException('지원하지 않는 파일 형식입니다. txt, pdf, docx 만 올릴 수 있습니다.');
  }
  return ext as ScriptFileType;
};

/** multer 는 originalname 을 latin1 로 해석한다. 한글 파일명 복원. */
export const decodeFileName = (name: string): string => Buffer.from(name, 'latin1').toString('utf8');

/** txt 디코딩: UTF-8 우선, 깨지면(U+FFFD) EUC-KR 재시도. */
export const decodeText = (buf: Buffer): string => {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try {
      const alt = new TextDecoder('euc-kr').decode(buf);
      if (!alt.includes('�')) text = alt;
    } catch {
      /* euc-kr 미지원 런타임이면 UTF-8 결과 사용 */
    }
  }
  return text.replace(/^﻿/, '');
};

@Injectable()
export class ScriptFileService {
  private readonly logger = new Logger(ScriptFileService.name);
  private readonly dir: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.dir = config.get('scriptStorageDir', { infer: true });
  }

  /** 원본 저장. 반환값은 저장 경로. 파일명은 uuid (원본 파일명은 DB 에만). */
  async save(buffer: Buffer, type: ScriptFileType): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, `${randomUUID()}.${type}`);
    await writeFile(path, buffer, { mode: 0o600 });
    return path;
  }

  async remove(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`대본 파일 삭제 실패: ${(e as Error).message}`);
      }
    }
  }

  async readText(path: string, type: string): Promise<string> {
    const buffer = await readFile(path);
    return this.extractText(buffer, type as ScriptFileType);
  }

  /** 본문 추출. 비어 있거나 너무 길면 400. */
  async extractText(buffer: Buffer, type: ScriptFileType): Promise<string> {
    let text: string;
    try {
      if (type === 'txt') {
        text = decodeText(buffer);
      } else if (type === 'pdf') {
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        try {
          text = (await parser.getText()).text;
        } finally {
          await parser.destroy();
        }
      } else {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ buffer })).value;
      }
    } catch (e) {
      this.logger.warn(`텍스트 추출 실패(${type}): ${(e as Error).message}`);
      throw new BadRequestException('파일에서 텍스트를 읽을 수 없습니다. 파일이 손상되었거나 스캔 이미지일 수 있습니다.');
    }
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) throw new BadRequestException('파일에 읽을 수 있는 텍스트가 없습니다.');
    if (text.length > MAX_SCRIPT_CHARS) {
      throw new BadRequestException(`대본이 너무 깁니다. 최대 ${MAX_SCRIPT_CHARS.toLocaleString('ko-KR')}자까지 분석할 수 있습니다.`);
    }
    return text;
  }
}
