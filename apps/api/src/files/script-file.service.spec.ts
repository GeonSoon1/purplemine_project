import { UnsupportedMediaTypeException } from '@nestjs/common';
import { decodeFileName, decodeText, fileTypeOf } from './script-file.service';

describe('script-file helpers', () => {
  it('확장자 판별(대소문자 무시), 미지원은 415', () => {
    expect(fileTypeOf('a.TXT')).toBe('txt');
    expect(fileTypeOf('대본.docx')).toBe('docx');
    expect(() => fileTypeOf('a.hwp')).toThrow(UnsupportedMediaTypeException);
    expect(() => fileTypeOf('noext')).toThrow(UnsupportedMediaTypeException);
  });
  it('multer 의 latin1 파일명을 UTF-8 로 복원', () => {
    const garbled = Buffer.from('서울의 밤.txt', 'utf8').toString('latin1');
    expect(decodeFileName(garbled)).toBe('서울의 밤.txt');
  });
  it('txt 디코딩: UTF-8(BOM 제거), EUC-KR 폴백', () => {
    expect(decodeText(Buffer.from('﻿S#1. 도로 / 낮', 'utf8'))).toBe('S#1. 도로 / 낮');
    const euckr = Buffer.from([0xb4, 0xeb, 0xba, 0xbb]); // "대본" (EUC-KR)
    expect(decodeText(euckr)).toBe('대본');
  });
});
