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
  title: {
    default: "RowsnColumns AI",
    template: "%s | RowsnColumns AI",
  },
  description:
    "RowsnColumns AI turns spreadsheet work into auditable, production-grade workflows for finance and operations teams.",
  applicationName: "RowsnColumns AI",
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
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
