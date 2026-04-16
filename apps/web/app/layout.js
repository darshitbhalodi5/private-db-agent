import './globals.css';

export const metadata = {
  title: 'Eigen Data Router',
  description: 'Policy-aware aggregation layer for private database agents and runtime-verified operations.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
