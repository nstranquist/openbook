import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { Email } from "@convex-dev/auth/providers/Email";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import {
  convexAuth,
  getAuthUserId,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";

const resendKey = process.env.RESEND_API_KEY;
function mailer(id: string, subject: string) {
  return Email({
  id,
  apiKey: resendKey,
  async sendVerificationRequest({
    identifier,
    token,
  }: {
    identifier: string;
    token: string;
  }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("Password reset is not configured");
    }
    const from = process.env.EMAIL_FROM || "Openbook <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: identifier,
        subject,
        text: `Your Openbook code is ${token}. It expires in about an hour.`,
      }),
    });
    if (!res.ok) throw new Error(`reset email: HTTP ${res.status}`);
  },
});
}
const resetEmail = resendKey ? mailer("password-reset", "Reset your Openbook password") : undefined;
const verifyEmail = resendKey ? mailer("email-verify", "Verify your Openbook email") : undefined;

function PasswordChange() {
  return ConvexCredentials({
    id: "password-change",
    authorize: async (params, ctx) => {
      const userId = await getAuthUserId(ctx);
      if (!userId) throw new Error("Not authenticated");
      const email = String(params.email ?? "").trim();
      const currentPassword = params.currentPassword as string | undefined;
      const newPassword = params.newPassword as string | undefined;
      if (!email || !currentPassword || !newPassword) {
        throw new Error("Missing fields");
      }
      if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      const retrieved = await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email, secret: currentPassword },
      });
      if (retrieved === null || retrieved.user._id !== userId) {
        throw new Error("Invalid credentials");
      }
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id: email, secret: newPassword },
      });
      return { userId };
    },
  });
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({ reset: resetEmail, verify: verifyEmail }),
    PasswordChange(),
    GitHub,
    Google,
  ],
});
