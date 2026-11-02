// Product cardinality limits keep each Convex transaction below a documented
// read and write budget. Increase a limit only with a scale-test receipt.
export const MAX_FRIENDS = 5_000;
export const MAX_FRIEND_LIST_RESULTS = 100;
export const MAX_PENDING_FRIEND_REQUESTS = 100;
export const MAX_SUGGESTION_SEED_FRIENDS = 40;
export const MAX_SUGGESTION_FRIENDS_PER_SEED = 40;
export const MAX_BLOCKS = 2_000;
export const MAX_MUTES = 2_000;
export const MAX_GROUPS_PER_USER = 500;
export const MAX_ALBUMS_PER_USER = 200;
export const MAX_PHOTOS_PER_ALBUM = 500;
export const MAX_PUSH_SUBSCRIPTIONS = 8;
export const MAX_ACTIVE_UPLOAD_GRANTS = 4;
export const UPLOAD_GRANT_TTL_MS = 65 * 60 * 1000;
export const MAX_PAIR_ROWS = 8;
export const MAX_UNREAD_BADGE = 100;
export const NOTIFICATION_WRITE_BATCH = 100;
export const MAX_TYPING_ROWS = 8;
export const MAX_REACTION_PREVIEW = 100;
export const ACCOUNT_DELETION_BATCH = 50;
export const ACCOUNT_DELETION_STALE_MS = 20 * 60 * 1000;
export const ACCOUNT_DELETION_RESUME_BATCH = 25;
export const REQUIRED_USER_STATS_MIGRATION = "user-stats-v4";
// Convex HTTP action responses are limited to 20 MiB. Keep signed media below
// that boundary with room for transport overhead.
export const MAX_MEDIA_RESPONSE_BYTES = 19_000_000;

export function assertAtMost(label: string, count: number, maximum: number): void {
  if (count > maximum) throw new Error(`${label} exceeds the supported limit of ${maximum}`);
}
