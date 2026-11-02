export interface RuntimeMetadata {
  environment: string;
  release: string;
  production: boolean;
  configurationIssues: string[];
}

function value(name: string): string {
  return (process.env[name] ?? "").trim();
}

function isHTTPSOrigin(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === "https:" &&
      !!parsed.host &&
      !parsed.username &&
      !parsed.password &&
      (parsed.pathname === "/" || parsed.pathname === "") &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function productionConfigurationIssues(): string[] {
  if (value("OPENBOOK_ENV") !== "production") return [];
  const issues: string[] = [];
  const release = value("OPENBOOK_RELEASE");
  if (!release || release === "dev" || release === "unknown") issues.push("OPENBOOK_RELEASE");
  if (!isHTTPSOrigin(value("SITE_URL"))) issues.push("SITE_URL");
  if (!isHTTPSOrigin(value("CONVEX_SITE_URL"))) issues.push("CONVEX_SITE_URL");
  if (value("OPENBOOK_AUTH_MODE") !== "clerk") issues.push("OPENBOOK_AUTH_MODE");
  if (!isHTTPSOrigin(value("CLERK_JWT_ISSUER_DOMAIN"))) {
    issues.push("CLERK_JWT_ISSUER_DOMAIN");
  }
  if (!value("CLERK_SECRET_KEY").startsWith("sk_live_")) issues.push("CLERK_SECRET_KEY");
  const mediaSecret = value("MEDIA_SIGNING_SECRET");
  if (mediaSecret.length < 32 || mediaSecret === value("SITE_URL")) {
    issues.push("MEDIA_SIGNING_SECRET");
  }
  if (!value("OPERATOR_USER_IDS")) issues.push("OPERATOR_USER_IDS");
  if (value("OPENBOOK_SYNTHETIC_KEY").length < 32) issues.push("OPENBOOK_SYNTHETIC_KEY");
  if (value("CLIENT_ERROR_HASH_SECRET").length < 32) issues.push("CLIENT_ERROR_HASH_SECRET");
  if (value("EMAIL_PROVIDER") !== "resend" || !value("RESEND_API_KEY") || !value("EMAIL_FROM")) {
    issues.push("EMAIL_PROVIDER");
  }
  const billing = value("OPENBOOK_BILLING_MODE");
  if (billing !== "live" && billing !== "disabled") issues.push("OPENBOOK_BILLING_MODE");
  if (
    billing === "live" &&
    (!value("STRIPE_SECRET_KEY").startsWith("sk_live_") ||
      !value("STRIPE_WEBHOOK_SECRET") ||
      !value("STRIPE_PRICE_PRO").startsWith("price_"))
  ) {
    issues.push("STRIPE_LIVE_CONFIG");
  }
  const push = value("OPENBOOK_PUSH_MODE");
  if (push !== "enabled" && push !== "disabled") issues.push("OPENBOOK_PUSH_MODE");
  if (
    push === "enabled" &&
    (!value("VAPID_PUBLIC_KEY") || !value("VAPID_PRIVATE_KEY") || !value("VAPID_SUBJECT"))
  ) {
    issues.push("VAPID_CONFIG");
  }
  return [...new Set(issues)].sort();
}

export function runtimeMetadata(): RuntimeMetadata {
  const environment = value("OPENBOOK_ENV") || "development";
  return {
    environment,
    release: value("OPENBOOK_RELEASE") || "dev",
    production: environment === "production",
    configurationIssues: productionConfigurationIssues(),
  };
}

export function billingIsEnabled(): boolean {
  const mode = value("OPENBOOK_BILLING_MODE");
  if (mode === "live") return true;
  if (mode === "disabled" || value("OPENBOOK_ENV") === "production") return false;
  return value("STRIPE_SECRET_KEY") !== "" && value("STRIPE_PRICE_PRO") !== "";
}

export function pushIsEnabled(): boolean {
  const mode = value("OPENBOOK_PUSH_MODE");
  if (mode === "enabled") return true;
  if (mode === "disabled" || value("OPENBOOK_ENV") === "production") return false;
  return value("VAPID_PUBLIC_KEY") !== "" && value("VAPID_PRIVATE_KEY") !== "";
}

export function requireProductionSecret(name: string, developmentFallback: string): string {
  const configured = value(name);
  if (configured) return configured;
  if (value("OPENBOOK_ENV") === "production") {
    throw new Error(`${name} is required in production`);
  }
  return developmentFallback;
}
