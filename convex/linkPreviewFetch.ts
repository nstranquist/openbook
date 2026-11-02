"use node";

import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  extractFirstHttpUrl,
  isPublicIpAddress,
  normalizePreviewUrl,
  parseOpenGraph,
} from "./lib/unfurl";

const FETCH_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 120_000;
const MAX_PREVIEW_IMAGE_BYTES = 2_000_000;
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const IMAGE_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type PinnedAddress = { address: string; family: number };
type FetchResult = { body: Buffer; contentType: string; finalUrl: string };
type OneRequestResult =
  | { kind: "redirect"; location: string }
  | { kind: "body"; body: Buffer; contentType: string };

async function beforeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Preview request timed out");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Preview request timed out")), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolvePublicAddress(url: URL, deadline: number): Promise<PinnedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) throw new Error("Preview destination is not public");
    return { address: hostname, family: literalFamily };
  }

  const answers = await beforeDeadline(
    lookup(hostname, { all: true, verbatim: true }),
    deadline,
  );
  if (answers.length === 0 || answers.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Preview destination is not public");
  }
  return answers[0]!;
}

async function requestPinned(
  url: URL,
  deadline: number,
  maxBytes: number,
  acceptedTypes: Set<string>,
): Promise<OneRequestResult> {
  const pinned = await resolvePublicAddress(url, deadline);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Preview request timed out");

  return await new Promise<OneRequestResult>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: OneRequestResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    };

    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      {
        protocol: url.protocol,
        hostname: pinned.address,
        port: url.protocol === "https:" ? 443 : 80,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
        headers: {
          Accept: [...acceptedTypes].join(", "),
          "Accept-Encoding": "identity",
          Host: url.host,
          "User-Agent": "OpenbookPreview/1.0",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          response.destroy();
          finish({ kind: "redirect", location });
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          fail(new Error(`Preview request returned ${status}`));
          return;
        }

        const contentEncoding = String(response.headers["content-encoding"] ?? "identity");
        if (contentEncoding !== "identity") {
          response.destroy();
          fail(new Error("Preview response used an unsupported content encoding"));
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";", 1)[0]!
          .trim()
          .toLowerCase();
        if (!acceptedTypes.has(contentType)) {
          response.destroy();
          fail(new Error("Preview response has an unsupported content type"));
          return;
        }
        const declaredLength = String(response.headers["content-length"] ?? "");
        if (declaredLength) {
          if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
            response.destroy();
            fail(new Error("Preview response is too large"));
            return;
          }
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.byteLength;
          if (size > maxBytes) {
            response.destroy();
            fail(new Error("Preview response is too large"));
            return;
          }
          chunks.push(bytes);
        });
        response.once("end", () =>
          finish({ kind: "body", body: Buffer.concat(chunks), contentType }),
        );
        response.once("aborted", () => fail(new Error("Preview response was interrupted")));
        response.once("error", (error) => fail(error));
      },
    );
    timer = setTimeout(
      () => req.destroy(new Error("Preview request timed out")),
      remaining,
    );
    req.once("error", (error) => fail(error));
    req.end();
  });
}

async function fetchPublic(
  rawUrl: string,
  maxBytes: number,
  acceptedTypes: Set<string>,
): Promise<FetchResult> {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  let current = normalizePreviewUrl(rawUrl);
  if (!current) throw new Error("Preview URL is not allowed");

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const result = await requestPinned(new URL(current), deadline, maxBytes, acceptedTypes);
    if (result.kind === "body") return { ...result, finalUrl: current };
    if (redirects === MAX_REDIRECTS) throw new Error("Too many preview redirects");
    current = normalizePreviewUrl(new URL(result.location, current).toString());
    if (!current) throw new Error("Preview redirect is not allowed");
  }
  throw new Error("Too many preview redirects");
}

export const unfurl = internalAction({
  args: { postId: v.id("posts"), body: v.string() },
  handler: async (ctx, { postId, body }) => {
    const url = extractFirstHttpUrl(body);
    if (!url) return;
    let imageId: Id<"_storage"> | undefined;
    try {
      const page = await fetchPublic(url, MAX_HTML_BYTES, HTML_TYPES);
      const parsed = parseOpenGraph(page.body.toString("utf8"), page.finalUrl);
      if (parsed.imageUrl) {
        try {
          const image = await fetchPublic(
            parsed.imageUrl,
            MAX_PREVIEW_IMAGE_BYTES,
            IMAGE_TYPES,
          );
          imageId = await ctx.storage.store(
            new Blob([new Uint8Array(image.body)], { type: image.contentType }),
          );
        } catch {
          // A preview without an image is still useful and does not leak the URL to clients.
        }
      }
      if (!parsed.title && !parsed.description && !imageId) return;
      const apply = async () =>
        await ctx.runMutation(internal.linkPreview.apply, {
          postId,
          expectedBody: body,
          preview: {
            url: parsed.url,
            title: parsed.title,
            description: parsed.description,
            imageId,
          },
        });
      let applied: boolean;
      try {
        applied = await apply();
      } catch (error) {
        if (!imageId) throw error;
        await ctx.storage.delete(imageId).catch(() => undefined);
        imageId = undefined;
        applied = await apply();
      }
      if (!applied && imageId) await ctx.storage.delete(imageId);
    } catch {
      if (imageId) await ctx.storage.delete(imageId).catch(() => undefined);
    }
  },
});
