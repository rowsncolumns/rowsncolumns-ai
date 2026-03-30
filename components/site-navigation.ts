export type NavigationItem = {
  label: string;
  href: string;
};

export const siteNavigation: NavigationItem[] = [
  { label: "Platform", href: "/#platform" },
  { label: "Collaboration", href: "/#collaboration" },
  { label: "Workflows", href: "/#workflows" },
  { label: "Security", href: "/#security" },
  { label: "Pricing", href: "/pricing" },
];

export const authenticatedSiteNavigation: NavigationItem[] = [
  { label: "My Sheets", href: "/sheets" },
  { label: "Pricing", href: "/pricing" },
  { label: "Settings", href: "/account/settings" },
  { label: "Billing", href: "/account/billing" },
  { label: "Contact", href: "/contact" },
];

export const legalNavigation = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Contact", href: "/contact" },
];

export const supportEmail = "sales@rowsncolumns.app";
