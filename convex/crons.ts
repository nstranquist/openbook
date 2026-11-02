import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("ops scheduler heartbeat", { minutes: 5 }, internal.health.heartbeat, {});
crons.interval("dispatch durable deliveries", { minutes: 1 }, internal.delivery.dispatch, {});
crons.interval("gc unused uploads", { minutes: 10 }, internal.gc.unusedUploads, {});
crons.interval("gc orphaned storage", { minutes: 10 }, internal.gc.orphanedStorage, {});
crons.interval("gc expired stories", { minutes: 10 }, internal.gc.expiredStories, {});
crons.interval("prune ephemeral records", { minutes: 15 }, internal.maintenance.pruneEphemeral, {});
crons.interval("resume account deletion", { minutes: 15 }, internal.profiles.resumeAccountDeletions, {});
crons.interval("resume production migrations", { minutes: 5 }, internal.migrations.resumeStale, {});
export default crons;
