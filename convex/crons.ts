import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("gc unused uploads", { hours: 1 }, internal.gc.unusedUploads, {});
crons.interval("gc expired stories", { hours: 1 }, internal.gc.expiredStories, {});
export default crons;
