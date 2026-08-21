import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractFirstHttpUrl, parseOpenGraph } from "./lib/unfurl";

export const apply = internalMutation({
  args: {
    postId: v.id("posts"),
    preview: v.object({
      url: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { postId, preview }) => {
    const post = await ctx.db.get(postId);
    if (!post) return;
    await ctx.db.patch(postId, { linkPreview: preview });
  },
});

export const unfurl = internalAction({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, { postId, body }) => {
    const url = extractFirstHttpUrl(body);
    if (!url) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "text/html", "User-Agent": "OpenbookPreview/1.0" },
        signal: ac.signal,
      });
      if (!res.ok) return;
      const ctype = res.headers.get("content-type") ?? "";
      if (!ctype.includes("html")) return;
      const html = (await res.text()).slice(0, 120_000);
      const preview = parseOpenGraph(html, url);
      if (!preview.title && !preview.description && !preview.imageUrl) return;
      await ctx.runMutation(internal.linkPreview.apply, { postId, preview });
    } catch {
      return;
    } finally {
      clearTimeout(timer);
    }
  },
});
