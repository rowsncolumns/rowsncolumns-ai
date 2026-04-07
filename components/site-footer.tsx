import { legalNavigation, siteNavigation } from "@/components/site-navigation";
import { cn } from "@/lib/utils";

type SiteFooterProps = {
  fullWidth?: boolean;
  className?: string;
};

export function SiteFooter({ fullWidth = false, className }: SiteFooterProps) {
  return (
    <footer
      className={cn(
        "px-5 pb-10 pt-4 sm:px-8 lg:px-12",
        fullWidth && "px-4",
        className,
      )}
    >
      <div
        className={`flex flex-col gap-4 rounded-[18px] border border-(--card-border) bg-(--card-bg) px-6 py-5 text-sm text-(--muted-foreground) md:flex-row md:items-center md:justify-between ${
          fullWidth ? "w-full" : "mx-auto max-w-7xl"
        }`}
      >
        <p>RowsnColumns AI. Spreadsheets, supercharged.</p>
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
