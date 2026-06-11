// Convex Auth issuer config. CONVEX_SITE_URL is provided by the deployment.
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
