import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  IBM_Plex_Mono,
  Plus_Jakarta_Sans,
  Sora,
} from "next/font/google";

import {
  DARK_THEME_CLASS,
  parseThemeCookie,
  THEME_COOKIE,
} from "@/lib/theme-preference";
import { PostHogProvider } from "@/lib/analytics/posthog-client";
import { SonnerToaster } from "@/components/sonner-toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import "sonner/dist/styles.css";
import "./globals.css";

const fontBody = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const fontDisplay = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
});

const fontMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: "500",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rowsncolumns.ai"),
  title: {
    default: "RowsnColumns AI",
    template: "%s | RowsnColumns AI",
  },
  description:
    "RowsnColumns AI turns spreadsheet work into auditable, production-grade workflows for finance and operations teams.",
  applicationName: "RowsnColumns AI",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "RowsnColumns AI",
    title: "RowsnColumns AI",
    description:
      "RowsnColumns AI turns spreadsheet work into auditable, production-grade workflows for finance and operations teams.",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "RowsnColumns AI workflow preview inside a spreadsheet",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RowsnColumns AI",
    description:
      "RowsnColumns AI turns spreadsheet work into auditable, production-grade workflows for finance and operations teams.",
    images: ["/og-image.jpg"],
  },
  manifest: "/site.webmanifest",
  icons: {
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
      },
    ],
    icon: [
      {
        url: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
    ],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://rowsncolumns.ai/#organization",
      name: "RowsnColumns AI",
      url: "https://rowsncolumns.ai",
      logo: "https://rowsncolumns.ai/favicon-32x32.png",
    },
    {
      "@type": "WebSite",
      "@id": "https://rowsncolumns.ai/#website",
      url: "https://rowsncolumns.ai",
      name: "RowsnColumns AI",
      description:
        "RowsnColumns AI turns spreadsheet work into auditable, production-grade workflows for finance and operations teams.",
      publisher: {
        "@id": "https://rowsncolumns.ai/#organization",
      },
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://rowsncolumns.ai/#software",
      name: "RowsnColumns AI",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://rowsncolumns.ai",
      description:
        "AI-powered spreadsheet workflows for finance and operations with auditable changes and production-ready outputs.",
      publisher: {
        "@id": "https://rowsncolumns.ai/#organization",
      },
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeMode = parseThemeCookie(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable} h-full scroll-smooth antialiased`}
    >
      <body
        className={`min-h-full flex flex-col ${
          themeMode === "dark" ? DARK_THEME_CLASS : ""
        }`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <PostHogProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <SonnerToaster />
        </PostHogProvider>
      </body>
    </html>
  );
}
