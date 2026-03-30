"use client";

import { Menu, Moon, Sun, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
  getThemeModeFromBodyClass,
  toggleThemeMode,
} from "@/lib/theme-preference";
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
    return pathname === "/sheets" || pathname.startsWith("/sheets/");
  }
  if (pathOnly === "/account/settings") {
    return (
      pathname === "/account/settings" ||
      pathname.startsWith("/account/settings/")
    );
  }
  if (pathOnly === "/account/billing") {
    return (
      pathname === "/account/billing" ||
      pathname.startsWith("/account/billing/")
    );
  }
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
};

function ThemeToggleButton() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const syncIsDarkMode = () => {
      setIsDarkMode(getThemeModeFromBodyClass() === "dark");
    };

    syncIsDarkMode();

    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(syncIsDarkMode);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <button
      type="button"
      className="rnc-theme-toggle"
      onClick={() => {
        setIsDarkMode(toggleThemeMode() === "dark");
      }}
      aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
      title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function SiteHeader({ homeHref = "/", initialUser }: SiteHeaderProps) {
  const { data: sessionData } = authClient.useSession();
  const pathname = usePathname() ?? "/";
  const user = sessionData?.user ?? initialUser;
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

            <ThemeToggleButton />
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
