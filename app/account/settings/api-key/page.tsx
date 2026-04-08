import { redirect } from "next/navigation";
export default function LegacyAccountApiKeyPage() {
  redirect("/account/settings/developers");
}
