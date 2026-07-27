import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'lisplendor',
  description: 'Splendor の局面編集・AI対局GUIです。',
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
