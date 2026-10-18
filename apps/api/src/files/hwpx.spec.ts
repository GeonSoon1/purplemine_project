import JSZip from 'jszip';
import { extractHwpxText } from './hwpx';

const build = async (files: Record<string, string>): Promise<Buffer> => {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer' });
};

const section = (...paras: string[]) =>
  `<?xml version="1.0"?><hs:sec xmlns:hs="x" xmlns:hp="y">${paras
    .map((p) => `<hp:p id="0"><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`)
    .join('')}</hs:sec>`;

describe('extractHwpxText', () => {
  it('섹션 순서(숫자)대로 문단을 이어 붙이고 XML 엔티티를 풀어 준다', async () => {
    const buf = await build({
      'Contents/section10.xml': section('마지막'),
      'Contents/section2.xml': section('S#2. 도로 / 밤', 'A &amp; B &lt;추격&gt;'),
      'Contents/section0.xml': section('S#1. 주차장 / 낮'),
      'Contents/header.xml': '<x><hp:t>본문 아님</hp:t></x>',
    });
    expect(await extractHwpxText(buf)).toBe('S#1. 주차장 / 낮\nS#2. 도로 / 밤\nA & B <추격>\n마지막');
  });

  it('한 문단 안의 여러 run, 줄바꿈, 탭을 순서대로 이어 붙인다', async () => {
    const xml =
      '<hs:sec><hp:p><hp:run><hp:t>검은 </hp:t></hp:run><hp:run><hp:t>세단</hp:t></hp:run>' +
      '<hp:lineBreak/><hp:run><hp:t>대기</hp:t></hp:run><hp:tab width="1"/><hp:run><hp:t>끝</hp:t></hp:run></hp:p></hs:sec>';
    expect(await extractHwpxText(await build({ 'Contents/section0.xml': xml }))).toBe('검은 세단\n대기\t끝');
  });

  it('본문 섹션이 없거나 zip 이 아니면 오류', async () => {
    await expect(extractHwpxText(await build({ mimetype: 'application/hwp+zip' }))).rejects.toThrow();
    await expect(extractHwpxText(Buffer.from('not a zip'))).rejects.toThrow();
  });
});
