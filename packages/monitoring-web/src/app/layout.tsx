import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './global.css';
import { AuthContextProvider } from '@/lib/auth-context';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Dex Monitoring',
  description: 'Error monitoring and log management platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <AuthContextProvider>{children}</AuthContextProvider>
      </body>
    </html>
  );
}
