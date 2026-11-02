"use node";

export async function deleteClerkUser(clerkUserId: string): Promise<void> {
  const secret = (process.env.CLERK_SECRET_KEY ?? "").trim();
  if (!secret) throw new Error("Clerk deletion is not configured");
  const response = await fetch(
    `https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Clerk user deletion returned HTTP ${response.status}`);
}
