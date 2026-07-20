import { z } from "zod";

// Validation lives here once and is reused by every platform's forms.
// The server enforces the same bounds; these exist for instant client feedback.

export const postInput = z.object({
  body: z.string().trim().min(1, "Say something first").max(5000),
  audience: z.enum(["public", "friends"]),
});
export type PostInput = z.infer<typeof postInput>;

export const commentInput = z.object({
  body: z.string().trim().min(1, "Comment cannot be empty").max(2000),
});
export type CommentInput = z.infer<typeof commentInput>;

export const messageInput = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type MessageInput = z.infer<typeof messageInput>;

export const profileInput = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(80),
  bio: z.string().max(500).optional(),
  work: z.string().max(500).optional(),
  location: z.string().max(500).optional(),
});
export type ProfileInput = z.infer<typeof profileInput>;

// Six social reactions, with their display glyphs, in one place.
export const REACTIONS = [
  { kind: "like", emoji: "👍", label: "Like" },
  { kind: "love", emoji: "❤️", label: "Love" },
  { kind: "haha", emoji: "😆", label: "Haha" },
  { kind: "wow", emoji: "😮", label: "Wow" },
  { kind: "sad", emoji: "😢", label: "Sad" },
  { kind: "angry", emoji: "😡", label: "Angry" },
] as const;
export type ReactionKind = (typeof REACTIONS)[number]["kind"];

export function reactionEmoji(kind: string): string {
  return REACTIONS.find((r) => r.kind === kind)?.emoji ?? "👍";
}
