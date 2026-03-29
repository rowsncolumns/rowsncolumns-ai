import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sheets",
  description: "Redirecting to sheets.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function NewPage() {
  redirect("/sheets");
}
