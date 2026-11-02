import { afterEach, describe, expect, it } from "vitest";
import {
  billingIsEnabled,
  productionConfigurationIssues,
  pushIsEnabled,
  requireProductionSecret,
  runtimeMetadata,
} from "./runtime";
import { configuredAuthMode } from "./authIdentity";

const original = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, original);
});

describe("production runtime contract", () => {
  it("fails closed when production configuration is incomplete", () => {
    process.env.OPENBOOK_ENV = "production";
    delete process.env.OPENBOOK_AUTH_MODE;
    expect(productionConfigurationIssues()).toContain("MEDIA_SIGNING_SECRET");
    expect(() => configuredAuthMode()).toThrow("Production authentication requires Clerk");
    expect(() => requireProductionSecret("MEDIA_SIGNING_SECRET", "dev")).toThrow(
      "MEDIA_SIGNING_SECRET is required in production",
    );
  });

  it("accepts an explicit production backend contract", () => {
    const longTestValue = "not-secret-".repeat(4);
    Object.assign(process.env, {
      OPENBOOK_ENV: "production",
      OPENBOOK_RELEASE: "release-123",
      SITE_URL: "https://openbook.example.com",
      CONVEX_SITE_URL: "https://actions.openbook.example.com",
      OPENBOOK_AUTH_MODE: "clerk",
      CLERK_JWT_ISSUER_DOMAIN: "https://clerk.openbook.example.com",
      CLERK_SECRET_KEY: "sk_live_secret",
      MEDIA_SIGNING_SECRET: longTestValue,
      OPERATOR_USER_IDS: "user_1",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_live",
      EMAIL_FROM: "Openbook <mail@example.com>",
      OPENBOOK_BILLING_MODE: "disabled",
      OPENBOOK_PUSH_MODE: "disabled",
      OPENBOOK_SYNTHETIC_KEY: longTestValue,
      CLIENT_ERROR_HASH_SECRET: longTestValue,
    });
    expect(productionConfigurationIssues()).toEqual([]);
    expect(runtimeMetadata()).toMatchObject({
      environment: "production",
      release: "release-123",
      production: true,
    });
    expect(billingIsEnabled()).toBe(false);
    expect(pushIsEnabled()).toBe(false);
  });

  it("does not infer enabled production features from stale credentials", () => {
    Object.assign(process.env, {
      OPENBOOK_ENV: "production",
      OPENBOOK_BILLING_MODE: "disabled",
      OPENBOOK_PUSH_MODE: "disabled",
      STRIPE_SECRET_KEY: "sk_live_stale",
      STRIPE_PRICE_PRO: "price_stale",
      VAPID_PUBLIC_KEY: "stale",
      VAPID_PRIVATE_KEY: "stale",
    });
    expect(billingIsEnabled()).toBe(false);
    expect(pushIsEnabled()).toBe(false);
  });
});
