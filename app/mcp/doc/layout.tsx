import { NewBodyClass } from "@/app/doc/body-class";

export default function McpDocLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full max-h-full flex-1 flex-col">
      <NewBodyClass />
      {children}
    </div>
  );
}
