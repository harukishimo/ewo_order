import { StartButton } from '@/components/customer/start-button';
export default function Home() {
  return (
    <>
      <section className="home-hero">
        <div>
          <p className="eyebrow">ART, MADE FOR YOU</p>
          <h1>
            あなたの暮らしに、
            <br />
            一枚の絵。
          </h1>
          <p className="hero-copy">
            好きな色、飾りたい場所、大切な気持ち。
            <br />
            お話をしながら、あなただけの一枚を見つけましょう。
          </p>
          <StartButton />
          <p className="microcopy">まずはご希望を聞かせてください。</p>
        </div>
        <div className="gallery-scene">
          <div
            className="painting painting-hero"
            role="img"
            aria-label="青と緑の曲線を重ねた抽象画の作品イメージ"
          >
            <i />
            <b />
            <em />
          </div>
          <p>
            01 / 静かな午後 <span>作品イメージ</span>
          </p>
        </div>
      </section>
      <section className="home-section">
        <div className="section-title">
          <div>
            <p className="eyebrow">FIND YOUR CANVAS</p>
            <h2>暮らしに合うサイズから。</h2>
          </div>
          <p>
            テイストは、抽象画・風景画・植物など。
            <br />
            色や雰囲気は相談しながら決められます。
          </p>
        </div>
        <div className="size-gallery">
          {[
            { s: 'S', d: '20 × 20 cm', p: '10,000', c: 'art-s', t: '小さな余白に、彩りを。' },
            { s: 'M', d: '30 × 40 cm', p: '20,000', c: 'art-m', t: '毎日目にする、お気に入り。' },
            { s: 'L', d: '50 × 60 cm', p: '35,000', c: 'art-l', t: '空間の主役になる一枚。' },
          ].map((x) => (
            <article className="size-card" key={x.s}>
              <div className={`art-stage ${x.c}`} aria-hidden="true">
                <div />
              </div>
              <div className="size-meta">
                <h3>
                  {x.s} <span>{x.d}</span>
                </h3>
                <strong>{x.p}円</strong>
              </div>
              <p>{x.t}</p>
            </article>
          ))}
        </div>
        <p className="microcopy">
          表示はデモ料金です。決済・配送手続きは含まれません。画像は作品イメージです。
        </p>
      </section>
      <section className="home-section journey">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2>想いが、絵になるまで。</h2>
        <div className="steps">
          {[
            ['01', '相談する', 'チャットと選択肢で、サイズや雰囲気、ご予算を伝えます。'],
            ['02', '内容を確認する', 'ご希望とデモ料金を確認。ご自身の承認で依頼が確定します。'],
            ['03', '制作を待つ', '注文一覧から、制作の進み具合をご確認いただけます。'],
          ].map(([n, t, d]) => (
            <div key={n}>
              <span>{n}</span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
