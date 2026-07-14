import { ConvexError } from "convex/values";
import { Resend } from "resend";

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function sendOtpEmail(
  email: string,
  code: string,
): Promise<void> {
  const resend = getResendClient();
  const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
  const isProd =
    deployment.startsWith("prod:") || deployment.includes(":prod");

  if (!resend) {
    if (isProd) {
      throw new ConvexError(
        "Email delivery is not configured. Set RESEND_API_KEY in the Convex dashboard.",
      );
    }
    console.warn(
      `[ledge email] RESEND_API_KEY not configured; logging OTP for ${email} (dev only)`,
    );
    console.log(`Ledge OTP for ${email}: ${code}`);
    return;
  }

  const from = process.env.EMAIL_FROM ?? "Ledge <auth@ledge.app>";

  try {
    await resend.emails.send({
      from,
      to: email,
      subject: "Your Ledge sign-in code",
      text: `Your Ledge sign-in code is ${code}. It expires in 10 minutes.`,
    });
  } catch (err) {
    throw new ConvexError(
      `Email delivery failed: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`,
    );
  }
}
