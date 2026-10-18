import Link from 'next/link';
import { Fleet, Timecode } from '@/components/home';

const HOW = [
  { t: '대본 업로드', d: 'PDF, DOCX, TXT 파일과 작품 정보를 입력합니다.' },
  { t: '씬별 차량 분석', d: '씬마다 필요한 차종, 대수, 용도를 찾아 정리합니다.' },
  { t: '차량 매칭', d: '보유 차량 중 조건에 맞는 후보를 보고 고릅니다.' },
  { t: '견적서 발행', d: '대수와 기간, 금액을 고쳐 PDF나 엑셀로 내보냅니다.' },
];

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <span className="hud tl" aria-hidden="true">
          {'FPS 23.976   SHUTTER 90.0   WB 4300K'}
        </span>
        <span className="hud tr" aria-hidden="true">
          <i className="rec" />
          REC
        </span>
        <Timecode />
        <div className="hero-copy">
          <h1>
            대본 한 권으로
            <br />
            <em>촬영 차량</em> 견적까지
          </h1>
          <p className="lede">
            드라마와 영화 대본을 올리면 씬마다 필요한 차량을 찾아 PURPLE MINE 보유 차량과 맞추고, 견적서 초안을 만들어 드립니다.
          </p>
          <div className="cta">
            <Link href="/scripts/new" className="bracket-btn">
              견적 산출하기
            </Link>
            <Link href="/vehicles" className="btn ghost-light">
              보유 차량 보기
            </Link>
          </div>
        </div>
      </section>

      <div className="home-sec">
        <div className="panel steps-panel">
          <h3>견적 절차</h3>
          <ol className="how">
            {HOW.map((h, i) => (
              <li key={h.t}>
                <span className={`dot${i === HOW.length - 1 ? ' on' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                <b>{h.t}</b>
                <p>{h.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="home-sec">
        <div className="sec-title">
          <h3>보유 차량</h3>
          <i />
        </div>
        <Fleet />
      </div>
    </div>
  );
}
