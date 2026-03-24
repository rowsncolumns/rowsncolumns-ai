import type { AppProps } from "next/app";
import {
  IBM_Plex_Mono,
  Plus_Jakarta_Sans,
  Sora,
} from "next/font/google";

import "@/app/globals.css";

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

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div
      className={`${fontBody.className} ${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable} min-h-full`}
    >
      <Component {...pageProps} />
    </div>
  );
}
