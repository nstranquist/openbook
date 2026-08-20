#!/usr/bin/env node
// Print a VAPID key pair for Openbook web push. Does not write env.
//   node scripts/gen-vapid.mjs
//   npx convex env set VAPID_PUBLIC_KEY <public>
//   npx convex env set VAPID_PRIVATE_KEY <private>
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + keys.publicKey);
console.log("VAPID_PRIVATE_KEY=" + keys.privateKey);
console.log("VAPID_SUBJECT=mailto:openbook@localhost");
