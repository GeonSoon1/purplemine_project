import JSZip from 'jszip';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decodeEntities = (s: string): string =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, dec, hex, name) =>
    name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
  );

/** 섹션 XML 한 개에서 문단 단위로 본문을 뽑는다. */
const sectionText = (xml: string): string => {
  const paragraphs = xml.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) ?? [];
  return paragraphs
    .map((p) =>
      // 문단 안 순서대로: 글자(<hp:t>), 줄바꿈, 탭
      [...p.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>|<hp:(lineBreak)\s*\/>|<hp:(tab)\b[^>]*\/?>/g)]
        .map((m) =>
          m[1] !== undefined ? decodeEntities(m[1].replace(/<[^>]+>/g, '')) : m[2] ? '\n' : m[3] ? '\t' : '',
        )
        .join(''),
    )
    .join('\n');
};

/** HWPX(zip + XML)에서 본문 텍스트 추출. 구버전 바이너리 .hwp 는 지원하지 않는다. */
export async function extractHwpxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sections = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!sections.length) throw new Error('HWPX 본문 섹션(Contents/section*.xml)이 없습니다.');
  const parts: string[] = [];
  for (const name of sections) parts.push(sectionText(await zip.files[name].async('string')));
  return parts.join('\n');
}
