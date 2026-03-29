import "@rowsncolumns/spreadsheet/dist/spreadsheet.min.css";
import type { Metadata } from "next";
import { PostHogIdentify } from "@/components/posthog-identify";

import { NewBodyClass } from "./body-class";

export const metadata: Metadata = {
  title: "Spreadsheet Workspace",
  description:
    "Collaborative spreadsheet workspace with AI-assisted planning and execution.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NewLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full max-h-full flex-1 flex-col">
      <PostHogIdentify />
      <NewBodyClass />
      {children}
    </div>
  );
}
