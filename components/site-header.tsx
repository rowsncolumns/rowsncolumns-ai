"use client";

import { Menu, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AccountDropdown } from "@/components/account-dropdown";
import { AuthModalTrigger } from "@/components/auth-modal-trigger";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { authClient } from "@/lib/auth/client";
import {
  authenticatedSiteNavigation,
  siteNavigation,
} from "@/components/site-navigation";

type SiteHeaderUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type SiteHeaderProps = {
  homeHref?: string;
  initialUser?: SiteHeaderUser;
};

const isNavigationItemActive = (pathname: string, href: string): boolean => {
  if (!href.startsWith("/")) {
    return false;
  }

  if (href.includes("#")) {
    return false;
  }

  const pathOnly = href.split("#")[0] || "/";
  if (pathOnly === "/") {
    return pathname === "/";
  }
  if (pathOnly === "/sheets") {
    return (
      pathname === "/sheets" ||
      pathname.startsWith("/sheets/") ||
      /^\/org\/[^/]+\/sheets(?:\/|$)/.test(pathname)
    );
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
};

export function SiteHeader({ homeHref = "/", initialUser }: SiteHeaderProps) {
  const { data: sessionData } = authClient.useSession();
  const pathname = usePathname() ?? "/";
  const resolvedUser = sessionData?.user ?? initialUser;
  const isPseudoPublicUser =
    resolvedUser?.id?.startsWith("public:") === true ||
    resolvedUser?.id?.startsWith("mcp-") === true ||
    (resolvedUser?.name === "Public Viewer" && !resolvedUser?.email);
  const user = isPseudoPublicUser ? undefined : resolvedUser;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const navigationItems = user ? authenticatedSiteNavigation : siteNavigation;
  return (
    <>
      <header className="rnc-site-header relative rounded-xl border p-3 backdrop-blur sm:rounded-[18px] sm:p-4 md:p-5">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <a href={homeHref} className="flex items-center gap-2 sm:gap-3">
            <Image
              src="/logo-square.png"
              alt="RowsnColumns AI logo"
              width={50}
              height={39}
              className="rounded-sm max-w-12.5"
            />
            <div>
              <p className="display-font whitespace-nowrap text-sm font-semibold sm:text-lg">
                RowsnColumns AI
              </p>
              <p className="hidden text-sm text-(--muted-foreground) sm:block!">
                Agentic AI for Spreadsheets
              </p>
            </div>
          </a>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <nav className="rnc-site-header-nav hidden items-center gap-1 rounded-xl p-1 lg:flex!">
              {navigationItems.map((item) => {
                const isActive = isNavigationItemActive(pathname, item.href);
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`rnc-site-header-link rounded-lg px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-(--nav-hover) text-foreground"
                        : "text-(--muted-foreground)"
                    }`}
                  >
                    {item.label}
                  </a>
                );
              })}
            </nav>

            <button
              type="button"
              className="rnc-menu-toggle lg:hidden"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open navigation menu"
              title="Open navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            {user ? (
              <AccountDropdown
                name={user.name || user.email || "User"}
                email={user.email}
                image={user.image}
              />
            ) : (
              <AuthModalTrigger
                triggerText="Log in"
                triggerVariant="ghost"
                showIconOnMobile
              />
            )}
          </div>
        </div>
      </header>

      <Drawer
        direction="left"
        open={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
      >
        <DrawerContent className="lg:hidden">
          <DrawerHeader>
            <DrawerTitle>Navigation</DrawerTitle>
            <DrawerClose asChild>
              <button
                type="button"
                className="rnc-menu-toggle"
                aria-label="Close navigation menu"
                title="Close navigation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerClose>
          </DrawerHeader>

          <nav className="flex flex-col px-3 py-3">
            {navigationItems.map((item) => {
              const isActive = isNavigationItemActive(pathname, item.href);
              return (
                <a
                  key={item.label}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rnc-mobile-drawer-link ${
                    isActive
                      ? "bg-[var(--nav-hover)] text-[var(--foreground)]"
                      : ""
                  }`}
                  onClick={() => setIsDrawerOpen(false)}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </DrawerContent>
      </Drawer>
    </>
  );
}
