import { toast } from "../ui/garrid";

export async function runOrToast<T>(
  work: Promise<T>,
  fallback = "That didn't work",
): Promise<T | undefined> {
  try {
    return await work;
  } catch (err) {
    toast(err instanceof Error ? err.message : fallback, "err");
    return undefined;
  }
}
