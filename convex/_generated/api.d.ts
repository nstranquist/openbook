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
import type * as clientTelemetry from "../clientTelemetry.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as delivery from "../delivery.js";
import type * as deliveryWorker from "../deliveryWorker.js";
import type * as emails from "../emails.js";
import type * as events from "../events.js";
import type * as externalAuth from "../externalAuth.js";
import type * as friends from "../friends.js";
import type * as gc from "../gc.js";
import type * as groups from "../groups.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as lib_authIdentity from "../lib/authIdentity.js";
import type * as lib_clerk from "../lib/clerk.js";
import type * as lib_delivery from "../lib/delivery.js";
import type * as lib_httpBody from "../lib/httpBody.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_mediaSign from "../lib/mediaSign.js";
import type * as lib_ops from "../lib/ops.js";
import type * as lib_pagination from "../lib/pagination.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_pushEndpoint from "../lib/pushEndpoint.js";
import type * as lib_rate from "../lib/rate.js";
import type * as lib_runtime from "../lib/runtime.js";
import type * as lib_social from "../lib/social.js";
import type * as lib_stats from "../lib/stats.js";
import type * as lib_stripe from "../lib/stripe.js";
import type * as lib_unfurl from "../lib/unfurl.js";
import type * as lib_uploads from "../lib/uploads.js";
import type * as linkPreview from "../linkPreview.js";
import type * as linkPreviewFetch from "../linkPreviewFetch.js";
import type * as loadProbe from "../loadProbe.js";
import type * as maintenance from "../maintenance.js";
import type * as messages from "../messages.js";
import type * as migrations from "../migrations.js";
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
  clientTelemetry: typeof clientTelemetry;
  comments: typeof comments;
  crons: typeof crons;
  delivery: typeof delivery;
  deliveryWorker: typeof deliveryWorker;
  emails: typeof emails;
  events: typeof events;
  externalAuth: typeof externalAuth;
  friends: typeof friends;
  gc: typeof gc;
  groups: typeof groups;
  health: typeof health;
  http: typeof http;
  "lib/authIdentity": typeof lib_authIdentity;
  "lib/clerk": typeof lib_clerk;
  "lib/delivery": typeof lib_delivery;
  "lib/httpBody": typeof lib_httpBody;
  "lib/limits": typeof lib_limits;
  "lib/mediaSign": typeof lib_mediaSign;
  "lib/ops": typeof lib_ops;
  "lib/pagination": typeof lib_pagination;
  "lib/plans": typeof lib_plans;
  "lib/pushEndpoint": typeof lib_pushEndpoint;
  "lib/rate": typeof lib_rate;
  "lib/runtime": typeof lib_runtime;
  "lib/social": typeof lib_social;
  "lib/stats": typeof lib_stats;
  "lib/stripe": typeof lib_stripe;
  "lib/unfurl": typeof lib_unfurl;
  "lib/uploads": typeof lib_uploads;
  linkPreview: typeof linkPreview;
  linkPreviewFetch: typeof linkPreviewFetch;
  loadProbe: typeof loadProbe;
  maintenance: typeof maintenance;
  messages: typeof messages;
  migrations: typeof migrations;
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
