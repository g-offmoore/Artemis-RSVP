import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "../src/lib/auth";

export const metadata: Metadata = {
  title: "Artemis",
  description: "Store event operations dashboard"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              Artemis
            </Link>
            <nav className="nav">
              <span>{session.username}</span>
              <a href="/api/auth/logout">Sign out</a>
            </nav>
          </header>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
