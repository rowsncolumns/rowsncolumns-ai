import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageTitleBlock } from "@/components/page-title-block";
import { SiteFixedWidthPageShell } from "@/components/site-fixed-width-page-shell";
import { getServerSessionSafe } from "@/lib/auth/session-safe";

import { AccountSettingsNav } from "./account-settings-nav";
import { AccountProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Account Settings",
  description: "Manage your personal RowsnColumns AI account profile.",
  robots: {
    index: false,
    follow: false,
  },
};

const splitName = (value: string | null | undefined) => {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      firstName: "",
      lastName: "",
    };
  }

  const [firstName, ...rest] = normalized.split(" ");
  return {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
  };
};

export default async function AccountSettingsPage() {
  const session = await getServerSessionSafe();
  if (!session?.user) {
    redirect("/auth/sign-in?callbackURL=/account/settings");
  }

  const user = session.user;
  const { firstName, lastName } = splitName(user.name);

  return (
    <SiteFixedWidthPageShell
      initialUser={{
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      }}
    >
      <section className="mx-auto w-full rounded-2xl border border-(--card-border) bg-(--card-bg-solid) p-7 shadow-[0_24px_70px_var(--card-shadow)] sm:p-8">
        <AccountSettingsNav activeSegment="profile" />
        <PageTitleBlock
          title="Account Settings"
          tagline="Manage your personal profile details."
        />

        <div className="pt-2">
          <div className="rounded-xl border border-(--card-border) bg-(--card-bg) p-5">
            <h2 className="display-font text-xl font-semibold text-foreground">
              Personal information
            </h2>
            <p className="mt-1 text-sm text-(--muted-foreground)">
              Update your first and last name.
            </p>
            <div className="mt-4">
              <AccountProfileForm
                initialFirstName={firstName}
                initialLastName={lastName}
                email={user.email}
              />
            </div>
          </div>
        </div>
      </section>
    </SiteFixedWidthPageShell>
  );
}
