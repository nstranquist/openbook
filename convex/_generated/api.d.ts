/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as albums from "../albums.js";
import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as blocks from "../blocks.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as events from "../events.js";
import type * as friends from "../friends.js";
import type * as gc from "../gc.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as lib_mediaSign from "../lib/mediaSign.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_rate from "../lib/rate.js";
import type * as lib_social from "../lib/social.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as lib_unfurl from "../lib/unfurl.js";
import type * as lib_uploads from "../lib/uploads.js";
import type * as linkPreview from "../linkPreview.js";
import type * as messages from "../messages.js";
import type * as mutes from "../mutes.js";
import type * as notifications from "../notifications.js";
import type * as posts from "../posts.js";
import type * as profiles from "../profiles.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as reactions from "../reactions.js";
import type * as reports from "../reports.js";
import type * as saved from "../saved.js";
import type * as stories from "../stories.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  albums: typeof albums;
  auth: typeof auth;
  billing: typeof billing;
  blocks: typeof blocks;
  comments: typeof comments;
  crons: typeof crons;
  emails: typeof emails;
  events: typeof events;
  friends: typeof friends;
  gc: typeof gc;
  groups: typeof groups;
  http: typeof http;
  "lib/mediaSign": typeof lib_mediaSign;
  "lib/plans": typeof lib_plans;
  "lib/rate": typeof lib_rate;
  "lib/social": typeof lib_social;
  "lib/stripe": typeof lib_stripe;
  "lib/unfurl": typeof lib_unfurl;
  "lib/uploads": typeof lib_uploads;
  linkPreview: typeof linkPreview;
  messages: typeof messages;
  mutes: typeof mutes;
  notifications: typeof notifications;
  posts: typeof posts;
  profiles: typeof profiles;
  push: typeof push;
  pushSend: typeof pushSend;
  reactions: typeof reactions;
  reports: typeof reports;
  saved: typeof saved;
  stories: typeof stories;
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
