import type { Metadata } from 'next';
import './globals.css';
import '@/components/customer/customer.css';
export const metadata: Metadata = {
  title: 'Atelier — あなたの暮らしに、一枚の絵。',
  description: 'サイズも、色も、あなたらしく。会話から始めるオーダーペインティング。',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <a href="#main-content" className="skip-link">
          本文へ移動
        </a>
        {children}
      </body>
    </html>
  );
}
