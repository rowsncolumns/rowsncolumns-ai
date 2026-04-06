import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

type SiteHeaderFrameUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type SiteHeaderFrameProps = {
  initialUser?: SiteHeaderFrameUser;
  className?: string;
  contentClassName?: string;
};

export function SiteHeaderFrame({
  initialUser,
  className,
  contentClassName,
}: SiteHeaderFrameProps) {
  return (
    <div
      className={cn(
        "hero-grid overflow-hidden rounded-[20px] border border-[var(--card-border)] bg-(--card-bg) shadow-[0_30px_80px_var(--card-shadow)] backdrop-blur",
        className,
      )}
    >
      <div className={cn("p-4 sm:p-6", contentClassName)}>
        <SiteHeader initialUser={initialUser} />
      </div>
    </div>
  );
}
