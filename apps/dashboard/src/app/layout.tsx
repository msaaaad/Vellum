import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vellum Dashboard',
  description: 'Read-only audit chain browser.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
