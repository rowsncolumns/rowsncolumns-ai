import { auth } from "@/lib/auth/server";

const NEXT_COOKIE_MUTATION_ERROR_FRAGMENT =
  "Cookies can only be modified in a Server Action or Route Handler";

export async function getServerSessionSafe() {
  try {
    const result = await auth.getSession();
    return result.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(NEXT_COOKIE_MUTATION_ERROR_FRAGMENT)) {
      return null;
    }
    throw error;
  }
}
