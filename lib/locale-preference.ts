const DEFAULT_LOCALE = "en-US";
const DEFAULT_CURRENCY = "USD";
const DEFAULT_REGION = "US";

const EURO_REGIONS = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
]);

const REGION_TO_CURRENCY: Record<string, string> = {
  AE: "AED",
  AR: "ARS",
  AU: "AUD",
  BD: "BDT",
  BG: "BGN",
  BH: "BHD",
  BO: "BOB",
  BR: "BRL",
  CA: "CAD",
  CH: "CHF",
  CL: "CLP",
  CN: "CNY",
  CO: "COP",
  CZ: "CZK",
  DK: "DKK",
  EG: "EGP",
  GB: "GBP",
  GH: "GHS",
  HK: "HKD",
  HU: "HUF",
  ID: "IDR",
  IL: "ILS",
  IN: "INR",
  JP: "JPY",
  KE: "KES",
  KR: "KRW",
  KW: "KWD",
  LK: "LKR",
  MA: "MAD",
  MX: "MXN",
  MY: "MYR",
  NG: "NGN",
  NO: "NOK",
  NZ: "NZD",
  OM: "OMR",
  PE: "PEN",
  PH: "PHP",
  PK: "PKR",
  PL: "PLN",
  QA: "QAR",
  RO: "RON",
  RU: "RUB",
  SA: "SAR",
  SE: "SEK",
  SG: "SGD",
  TH: "THB",
  TR: "TRY",
  TW: "TWD",
  UA: "UAH",
  US: "USD",
  VN: "VND",
  ZA: "ZAR",
};

type LocaleCurrencyOptions = {
  acceptLanguage?: string | null;
  countryCode?: string | null;
};

const normalizeCountryCode = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
};

const toCanonicalLocale = (value?: string | null): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null;
  } catch {
    return null;
  }
};

const parsePreferredLocale = (
  acceptLanguage?: string | null,
): string | null => {
  if (!acceptLanguage) return null;

  const [first] = acceptLanguage.split(",");
  if (!first) return null;

  const [localeTag] = first.split(";");
  return toCanonicalLocale(localeTag);
};

const getRegionFromLocale = (locale: string): string | null => {
  try {
    const region = new Intl.Locale(locale).region;
    return region ? region.toUpperCase() : null;
  } catch {
    return null;
  }
};

const localeWithRegion = (
  locale: string,
  regionCode?: string | null,
): string => {
  const normalizedRegion = normalizeCountryCode(regionCode);
  if (!normalizedRegion) return locale;
  if (getRegionFromLocale(locale)) return locale;

  return toCanonicalLocale(`${locale}-${normalizedRegion}`) ?? locale;
};

const getCurrencyForRegion = (regionCode?: string | null): string => {
  const normalizedRegion = normalizeCountryCode(regionCode);
  if (!normalizedRegion) return DEFAULT_CURRENCY;

  if (EURO_REGIONS.has(normalizedRegion)) {
    return "EUR";
  }

  return REGION_TO_CURRENCY[normalizedRegion] ?? DEFAULT_CURRENCY;
};

export const resolveLocaleAndCurrency = ({
  acceptLanguage,
  countryCode,
}: LocaleCurrencyOptions): { locale: string; currency: string } => {
  const resolvedCountryCode = normalizeCountryCode(countryCode);
  const preferredLocale = parsePreferredLocale(acceptLanguage);
  const localeFromCountry = resolvedCountryCode
    ? toCanonicalLocale(`en-${resolvedCountryCode}`)
    : null;

  const locale = localeWithRegion(
    preferredLocale ?? localeFromCountry ?? DEFAULT_LOCALE,
    resolvedCountryCode ?? DEFAULT_REGION,
  );
  const region =
    resolvedCountryCode ?? getRegionFromLocale(locale) ?? DEFAULT_REGION;
  const currency = getCurrencyForRegion(region);

  return { locale, currency };
};
