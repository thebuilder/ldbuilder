import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

/**
 * Absolute base for the OpenGraph and Twitter card URLs.
 *
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL to the project's stable production
 * domain on every deployment, including previews, which is what a shared card
 * should point at. VERCEL_URL is the per-deployment URL, used when there is no
 * production domain yet. Without either, relative image URLs would resolve
 * against localhost and every card would 404 off this machine.
 */
function siteUrl(): URL {
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return new URL(host ? `https://${host}` : "http://localhost:3000");
}

export const metadata: Metadata = {
  description:
    "Load an LDraw model, tip the bricks onto the floor, and watch it assemble itself step by step. Explode, slice and inspect any piece.",
  metadataBase: siteUrl(),
  openGraph: {
    description:
      "Tip the bricks onto the floor and watch a model assemble itself, one build step at a time.",
    title: "LDBuilder",
    type: "website",
  },
  title: {
    default: "LDBuilder",
    template: "%s / LDBuilder",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // next-themes sets the theme class on <html> from an inline script before
    // paint, which is what avoids a flash of the wrong theme. That makes the
    // server and client markup differ on purpose, hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-ground text-ink antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
          enableSystem
        >
          <NuqsAdapter>{children}</NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
