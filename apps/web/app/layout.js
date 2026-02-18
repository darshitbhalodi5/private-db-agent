import './globals.css';

export const metadata = {
  title: 'Eigen Private DB Agent Console',
  description: 'Frontend control plane for dynamic policy-driven database management'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
