import type { AuthConfig } from "convex/server";

// Local dogfood uses Convex Auth. Production uses Clerk's supported Convex
// integration, so the beta issuer cannot mint a production application token.
const clerk = process.env.OPENBOOK_AUTH_MODE === "clerk";

export default {
  providers: [
    {
      domain: clerk
        ? process.env.CLERK_JWT_ISSUER_DOMAIN!
        : process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
