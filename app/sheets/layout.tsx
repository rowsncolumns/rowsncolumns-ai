import "@rowsncolumns/spreadsheet/dist/spreadsheet.min.css";
import type { Metadata } from "next";

import { PostHogIdentify } from "@/components/posthog-identify";

export const metadata: Metadata = {
  title: "Sheets",
  description: "Manage and edit your spreadsheet sheets.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SheetsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PostHogIdentify />
      {children}
    </div>
  );
}
