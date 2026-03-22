import { redirect } from "next/navigation";
import { uuidString } from "@rowsncolumns/utils";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Document",
  description: "Create a new spreadsheet document workspace.",
};

export default function NewPage() {
  const documentId = uuidString();
  redirect(`/doc/${documentId}`);
}
