import { Password } from "@convex-dev/auth/providers/Password";
import { Email } from "@convex-dev/auth/providers/Email";
import GitHub from "@auth/core/providers/github";
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

const resetEmail = Email({
  id: "password-reset",
  apiKey: process.env.RESEND_API_KEY ?? "unset",
  async sendVerificationRequest({
    identifier,
    token,
  }: {
    identifier: string;
    token: string;
  }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("Password reset is not configured (set RESEND_API_KEY)");
    }
    const from = process.env.EMAIL_FROM || "Openbook <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: identifier,
        subject: "Reset your Openbook password",
        text: `Your Openbook reset code is ${token}. It expires in about an hour.`,
      }),
    });
    if (!res.ok) throw new Error(`reset email: HTTP ${res.status}`);
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({ reset: resetEmail }),
    GitHub,
    Google,
  ],
});
