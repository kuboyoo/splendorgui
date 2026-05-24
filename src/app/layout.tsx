import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'lisplendor 局面エディタ',
  description: 'Splendor の局面エディタです。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark-ui" suppressHydrationWarning>
      <body className="dark-ui" suppressHydrationWarning>{children}</body>
    </html>
  );
}
