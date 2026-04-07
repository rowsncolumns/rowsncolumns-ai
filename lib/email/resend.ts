type SendResendEmailInput = {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

type ResendEmailResponse = {
  id?: string;
  message?: string;
};

export async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
}: SendResendEmailInput): Promise<ResendEmailResponse> {
  const recipients = Array.isArray(to) ? to : [to];
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      html,
      ...(text ? { text } : {}),
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | ResendEmailResponse
    | { message?: string; error?: string }
    | null;

  if (!response.ok) {
    const message =
      (payload &&
        typeof payload === "object" &&
        ("message" in payload || "error" in payload)
        ? (payload as { message?: string; error?: string }).message ??
          (payload as { message?: string; error?: string }).error
        : null) ?? `Resend request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return (payload as ResendEmailResponse | null) ?? {};
}
