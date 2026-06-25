import React from 'react';
import './globals.css';

export const metadata = {
  title: 'Enlight lab-AI Assistant',
  description: 'Embeddable Chat & Voice Widget',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
