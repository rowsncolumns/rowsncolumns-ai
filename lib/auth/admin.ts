type AdminUserIdentity = {
  id?: string | null;
  email?: string | null;
};

const parseEnvList = (value: string | undefined, normalize?: (item: string) => string) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => (normalize ? normalize(entry) : entry)),
  );

const ADMIN_USER_IDS = parseEnvList(process.env.RNC_ADMIN_USER_IDS);
const ADMIN_EMAILS = parseEnvList(process.env.RNC_ADMIN_EMAILS, (email) =>
  email.toLowerCase(),
);

export const isAdminUser = ({ id, email }: AdminUserIdentity) => {
  const normalizedEmail = email?.trim().toLowerCase();
  return (
    (!!id && ADMIN_USER_IDS.has(id)) ||
    (!!normalizedEmail && ADMIN_EMAILS.has(normalizedEmail))
  );
};

