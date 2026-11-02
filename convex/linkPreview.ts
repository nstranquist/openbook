import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { deleteOwnedUpload, registerClaimedUpload } from "./lib/uploads";

export const apply = internalMutation({
  args: {
    postId: v.id("posts"),
    expectedBody: v.string(),
    preview: v.object({
      url: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      imageId: v.optional(v.id("_storage")),
    }),
  },
  handler: async (ctx, { postId, expectedBody, preview }) => {
    const post = await ctx.db.get(postId);
    if (!post || post.deletedAt || post.body !== expectedBody) return false;
    const previousImageId = post.linkPreview?.imageId;
    if (preview.imageId) {
      await registerClaimedUpload(ctx, post.authorId, preview.imageId);
    }
    await ctx.db.patch(postId, { linkPreview: preview });
    if (previousImageId && previousImageId !== preview.imageId) {
      await deleteOwnedUpload(ctx, post.authorId, previousImageId);
    }
    return true;
  },
});
