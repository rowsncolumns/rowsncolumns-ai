"use client";

import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  Loader2,
  LogOut,
  Moon,
  PlusSquareIcon,
  Settings,
  Sun,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";
import {
  applyThemeMode,
  getThemeModeFromBodyClass,
  type ThemeMode,
} from "@/lib/theme-preference";

type AccountDropdownProps = {
  name: string;
  email?: string | null;
  image?: string | null;
};

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (words.length === 0) return "U";
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

export function AccountDropdown({ name, email, image }: AccountDropdownProps) {
  const { data: sessionData } = authClient.useSession();
  const { data: organizationData } = authClient.useListOrganizations();
  const initials = initialsFromName(name);
  const signOutFormRef = useRef<HTMLFormElement>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<
    string | null
  >(null);

  const activeOrganizationId =
    typeof sessionData?.session?.activeOrganizationId === "string"
      ? sessionData.session.activeOrganizationId
      : null;

  const organizations = Array.isArray(organizationData)
    ? organizationData.filter((item) =>
        Boolean(item && typeof item.id === "string" && item.id.length > 0),
      )
    : [];
  const organizationBasePath = activeOrganizationId
    ? `/org/${encodeURIComponent(activeOrganizationId)}`
    : null;
  const onboardingOrganizationHref = `/onboarding/organization?callbackURL=${encodeURIComponent("/pricing")}`;
  const accountSettingsHref = "/account/settings";
  const organizationSettingsHref = organizationBasePath
    ? `${organizationBasePath}/settings`
    : null;
  const organizationBillingHref = organizationBasePath
    ? `${organizationBasePath}/billing`
    : onboardingOrganizationHref;
  const organizationPeopleHref = organizationBasePath
    ? `${organizationBasePath}/people`
    : null;

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncThemeMode = () => {
      setThemeMode(getThemeModeFromBodyClass());
    };

    syncThemeMode();

    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(syncThemeMode);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        signOutFormRef.current?.requestSubmit();
        return;
      }
      window.location.assign("/");
    } catch {
      signOutFormRef.current?.requestSubmit();
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleSetActiveOrganization = async (organizationId: string) => {
    if (
      switchingOrganizationId ||
      !organizationId ||
      activeOrganizationId === organizationId
    ) {
      return;
    }

    setSwitchingOrganizationId(organizationId);
    try {
      const { error } = await authClient.organization.setActive({
        organizationId,
      });
      if (!error) {
        window.location.assign("/sheets");
      }
    } finally {
      setSwitchingOrganizationId(null);
    }
  };

  const handleSetThemeMode = (nextMode: ThemeMode) => {
    applyThemeMode(nextMode);
    setThemeMode(nextMode);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9  rounded-lg px-0 sm:h-11 sm:px-2"
        >
          <span className="flex items-center gap-1.5 sm:gap-2">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt={name}
                className="h-7 w-7 rounded-full border border-(--card-border) object-cover sm:h-8 sm:w-8"
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-(--card-border) bg-(--card-bg-solid) text-[10px] font-semibold text-foreground sm:h-8 sm:w-8 sm:text-xs">
                {initials}
              </span>
            )}
            <span className="hidden max-w-[140px] truncate text-sm font-medium text-foreground sm:!inline">
              {name}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-(--muted-foreground) sm:!block" />
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-1">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">
            {name}
          </p>
          {email ? (
            <p className="truncate text-xs font-normal text-[var(--muted-foreground)]">
              {email}
            </p>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Building2 className="h-4 w-4" />
            Organization
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            {organizations.length > 0 ? (
              organizations.map((organization) => {
                const organizationName =
                  organization.name?.trim() || "Organization";
                const isActive = activeOrganizationId === organization.id;
                const isSwitching = switchingOrganizationId === organization.id;
                return (
                  <DropdownMenuItem
                    key={organization.id}
                    disabled={Boolean(switchingOrganizationId)}
                    onSelect={(event) => {
                      event.preventDefault();
                      void handleSetActiveOrganization(organization.id);
                    }}
                  >
                    {isSwitching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Building2 className="h-4 w-4" />
                    )}
                    <span className="max-w-[180px] truncate">
                      {organizationName}
                    </span>
                    {isActive ? <Check className="ml-auto h-4 w-4" /> : null}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem disabled>
                <Building2 className="h-4 w-4" />
                No organizations
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <a href="/onboarding/organization" className="cursor-pointer">
                <PlusSquareIcon className="h-4 w-4" />
                Create organization
              </a>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={accountSettingsHref} className="cursor-pointer">
            <Settings className="h-4 w-4" />
            Account settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {themeMode === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
            Theme: {themeMode === "dark" ? "Dark" : "Light"}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                handleSetThemeMode("light");
              }}
            >
              <Sun className="h-4 w-4" />
              Light
              {themeMode === "light" ? (
                <Check className="ml-auto h-4 w-4" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                handleSetThemeMode("dark");
              }}
            >
              <Moon className="h-4 w-4" />
              Dark
              {themeMode === "dark" ? (
                <Check className="ml-auto h-4 w-4" />
              ) : null}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {organizationSettingsHref ? (
          <DropdownMenuItem asChild>
            <a href={organizationSettingsHref} className="cursor-pointer">
              <Settings className="h-4 w-4" />
              Organization profile
            </a>
          </DropdownMenuItem>
        ) : null}

        {organizationPeopleHref ? (
          <DropdownMenuItem asChild>
            <a href={organizationPeopleHref} className="cursor-pointer">
              <Building2 className="h-4 w-4" />
              People
            </a>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuItem asChild>
          <a href={organizationBillingHref} className="cursor-pointer">
            <CreditCard className="h-4 w-4" />
            Billing
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <form ref={signOutFormRef} action="/auth/sign-out" method="post" />
        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <LogOut className="h-4 w-4" />
          {isSigningOut ? "Logging out..." : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
