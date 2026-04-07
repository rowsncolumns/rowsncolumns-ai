import { redirect } from "next/navigation";

type RouteParams = Promise<{ orgId: string }>;

export const dynamic = "force-dynamic";

export default async function OrganizationRootPage({
  params,
}: {
  params: RouteParams;
}) {
  await params;
  redirect("/sheets");
}
