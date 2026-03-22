"use client";

import { useRef } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  const initials = initialsFromName(name);
  const signOutFormRef = useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9  rounded-lg px-1.5 sm:h-11 sm:px-2"
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

        <DropdownMenuItem asChild>
          <a href="/account/settings" className="cursor-pointer">
            <Settings className="h-4 w-4" />
            Settings
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <form ref={signOutFormRef} action="/auth/sign-out" method="post" />
        <DropdownMenuItem
          onSelect={() => {
            signOutFormRef.current?.requestSubmit();
          }}
        >
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
