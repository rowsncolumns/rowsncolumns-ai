"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SheetsFilterValue = "owned" | "shared" | "my_shared" | "templates";

const FILTER_OPTIONS: Array<{ value: SheetsFilterValue; label: string }> = [
  { value: "owned", label: "My Sheets" },
  { value: "shared", label: "Shared with me" },
  { value: "my_shared", label: "Shared by me" },
  { value: "templates", label: "Templates" },
];

const buildSheetsHref = ({
  basePath,
  filter,
  query,
}: {
  basePath: string;
  filter: SheetsFilterValue;
  query?: string | null;
}) => {
  const searchParams = new URLSearchParams();
  if (filter !== "owned") {
    searchParams.set("filter", filter);
  }
  const normalizedQuery = query?.trim();
  if (normalizedQuery) {
    searchParams.set("q", normalizedQuery);
  }
  const serialized = searchParams.toString();
  return serialized ? `${basePath}?${serialized}` : basePath;
};

export function SheetsFilterPicker({
  value,
  query,
  basePath = "/sheets",
  buttonClassName = "",
}: {
  value: SheetsFilterValue;
  query?: string | null;
  basePath?: string;
  buttonClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  const selectedLabel =
    FILTER_OPTIONS.find((option) => option.value === value)?.label ??
    "My Sheets";

  const handleSelect = (next: SheetsFilterValue) => {
    setOpen(false);
    if (next === value) {
      return;
    }
    router.push(
      buildSheetsHref({
        basePath,
        filter: next,
        query,
      }),
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={`Filter sheets. Current filter: ${selectedLabel}`}
            title={`Filter: ${selectedLabel}`}
            className={`rnc-assistant-chip h-9 w-full justify-between rounded-lg border border-(--panel-border) bg-(--assistant-chip-bg) px-2.5 text-xs font-normal text-foreground shadow-none hover:bg-(--assistant-chip-hover) sm:min-w-40 sm:w-auto ${buttonClassName}`}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command>
            <CommandList>
              <CommandEmpty>No filter found.</CommandEmpty>
              <CommandGroup>
                {FILTER_OPTIONS.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => handleSelect(option.value)}
                    className="text-xs"
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
