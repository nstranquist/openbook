"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

// Provider-agnostic transactional email for Openbook. Pick your provider
// with the EMAIL_PROVIDER Convex env var — call sites never change:
//
//   npx convex env set EMAIL_PROVIDER resend   # + RESEND_API_KEY (zero deps, fetch)
//   npx convex env set EMAIL_PROVIDER ses      # + AWS_REGION/creds (npm i @aws-sdk/client-sesv2)
//   npx convex env set EMAIL_PROVIDER smtp     # + SMTP_HOST/... (npm i nodemailer)
//
// This runs in Convex's Node runtime ("use node") so SES/SMTP clients load
// lazily — you only install the one you choose. Call it from any mutation/action
// via ctx.runAction(api.emails.sendEmail, { to, subject, html }).

const FROM = process.env.EMAIL_FROM || "Openbook <onboarding@resend.dev>";

function providerName(): "resend" | "ses" | "smtp" {
  const p = (process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (p === "resend" || p === "ses" || p === "smtp") return p;
  if (process.env.SMTP_HOST) return "smtp";
  if (process.env.AWS_REGION && !process.env.RESEND_API_KEY) return "ses";
  return "resend";
}

async function deliver(to: string, subject: string, html?: string, text?: string): Promise<string> {
  switch (providerName()) {
    case "resend": {
      const key = process.env.RESEND_API_KEY;
      if (!key) throw new Error("RESEND_API_KEY is not set (EMAIL_PROVIDER=resend)");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject, html, text }),
      });
      if (!res.ok) throw new Error(`resend: HTTP ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { id: string };
      return data.id;
    }
    case "ses": {
      const region = process.env.AWS_REGION;
      if (!region) throw new Error("AWS_REGION is not set (EMAIL_PROVIDER=ses)");
      // Computed specifier so a Resend-only deployment bundles without the dep.
      const pkg = "@aws-sdk/client-sesv2";
      const { SESv2Client, SendEmailCommand } = await import(pkg);
      const client = new SESv2Client({ region });
      const out = await client.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { ...(html ? { Html: { Data: html } } : {}), ...(text ? { Text: { Data: text } } : {}) } } },
        }),
      );
      return out.MessageId ?? "";
    }
    case "smtp": {
      const host = process.env.SMTP_HOST;
      if (!host) throw new Error("SMTP_HOST is not set (EMAIL_PROVIDER=smtp)");
      const port = Number(process.env.SMTP_PORT || 587);
      const auth = process.env.SMTP_USERNAME ? { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } : undefined;
      const pkg = "nodemailer";
      const nodemailer = (await import(pkg)).default;
      const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth });
      const info = await transport.sendMail({ from: FROM, to, subject, html, text });
      return info.messageId as string;
    }
  }
}

export const sendEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (_ctx, { to, subject, html, text }) => {
    const id = await deliver(to, subject, html, text);
    return { id, provider: providerName() };
  },
});
