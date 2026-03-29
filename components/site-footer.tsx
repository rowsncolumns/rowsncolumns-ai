import { legalNavigation, siteNavigation } from "@/components/site-navigation";

export function SiteFooter() {
  return (
    <footer className="px-5 pb-10 pt-4 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 rounded-[18px] border border-(--card-border) bg-(--card-bg) px-6 py-5 text-sm text-(--muted-foreground) md:flex-row md:items-center md:justify-between">
        <p>
          RowsnColumns AI. Built for spreadsheet-native teams that need speed
          with control.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {siteNavigation.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
          {legalNavigation.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
