import { isAdminUser } from "@/lib/auth/admin";
import { getUserBillingEntitlement } from "@/lib/billing/repository";

export interface AuditHistoryAccessInput {
  userId: string;
  email?: string | null;
}

export interface AuditHistoryAccessResult {
  allowed: boolean;
  isAdmin: boolean;
  plan: "free" | "pro" | "max";
}

export async function resolveAuditHistoryAccess(
  input: AuditHistoryAccessInput
): Promise<AuditHistoryAccessResult> {
  const isAdmin = isAdminUser({
    id: input.userId,
    email: input.email,
  });

  if (isAdmin) {
    return {
      allowed: true,
      isAdmin: true,
      plan: "max",
    };
  }

  const entitlement = await getUserBillingEntitlement(input.userId);
  const plan = entitlement.plan;

  return {
    allowed: plan === "max",
    isAdmin: false,
    plan,
  };
}
