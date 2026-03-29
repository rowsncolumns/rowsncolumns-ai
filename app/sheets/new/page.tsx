import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { uuidString } from "@rowsncolumns/utils";

export const metadata: Metadata = {
  title: "Create Sheet",
  description: "Create a new spreadsheet sheet workspace.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NewSheetPage() {
  const documentId = uuidString();
  redirect(`/sheets/${documentId}`);
}
