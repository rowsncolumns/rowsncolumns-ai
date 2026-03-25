"use client";

import { Menu, Moon, Sun, X } from "lucide-react";
import Image from "next/image";
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
import { siteNavigation } from "@/components/site-navigation";

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
  const user = sessionData?.user ?? initialUser;
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

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
                Agentic AI for spreadsheet operations
              </p>
            </div>
          </a>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <nav className="rnc-site-header-nav hidden items-center gap-1 rounded-xl p-1 lg:flex!">
              {siteNavigation.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="rnc-site-header-link rounded-lg px-4 py-2 text-sm font-medium text-[var(--muted-foreground)] transition"
                >
                  {item.label}
                </a>
              ))}
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
            {siteNavigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rnc-mobile-drawer-link"
                onClick={() => setIsDrawerOpen(false)}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </DrawerContent>
      </Drawer>
    </>
  );
}
