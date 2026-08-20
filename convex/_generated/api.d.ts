/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as blocks from "../blocks.js";
import type * as comments from "../comments.js";
import type * as emails from "../emails.js";
import type * as friends from "../friends.js";
import type * as http from "../http.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_social from "../lib/social.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as reactions from "../reactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  billing: typeof billing;
  blocks: typeof blocks;
  comments: typeof comments;
  emails: typeof emails;
  friends: typeof friends;
  http: typeof http;
  "lib/plans": typeof lib_plans;
  "lib/social": typeof lib_social;
  "lib/stripe": typeof lib_stripe;
  messages: typeof messages;
  notifications: typeof notifications;
  posts: typeof posts;
  profiles: typeof profiles;
  reactions: typeof reactions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
