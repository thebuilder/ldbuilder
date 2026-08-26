import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Load an LDraw model, tip the bricks onto the floor, and watch it assemble itself step by step. Explode, slice and inspect any piece.",
  // Both the twitter and openGraph cards pick up app/opengraph-image.tsx.
  openGraph: {
    description:
      "Tip the bricks onto the floor and watch a model assemble itself, one build step at a time.",
    title: "LDraw Builder",
    type: "website",
  },
  title: {
    default: "LDraw Builder",
    template: "%s / LDraw Builder",
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
