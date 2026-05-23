import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "../src/lib/auth";

export const metadata: Metadata = {
  title: "Artemis",
  description: "Store event operations dashboard",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const primaryLinks = [
    { href: "/", label: "Dashboard" },
    { href: "/#upcoming-events", label: "Events" },
    { href: "/calendar", label: "Calendar" },
    { href: "/series", label: "Series" },
    { href: "/ambassadors", label: "Ambassadors" },
    { href: "/settings", label: "Settings" },
  ];

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar app-topbar">
            <Link className="brand" href="/">
              Artemis
            </Link>
            <div className="mobile-menu">
              <details>
                <summary>Menu</summary>
                <nav className="mobile-nav">
                  {primaryLinks.map((link) => (
                    <Link key={link.href} href={link.href}>
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </details>
            </div>
            <div className="account">
              <span>{session.username}</span>
              <a href="/api/auth/logout">Sign out</a>
            </div>
          </header>
          <div className="app-frame">
            <aside className="sidebar" aria-label="Primary navigation">
              <nav className="sidebar-nav">
                {primaryLinks.map((link) => (
                  <Link key={link.href} href={link.href}>
                    {link.label}
                  </Link>
                ))}
              </nav>
            </aside>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
