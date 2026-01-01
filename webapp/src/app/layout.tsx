import "./globals.css";

export const metadata = {
  title: "OSRS Bingo",
  description: "Clan blackout bingo tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
