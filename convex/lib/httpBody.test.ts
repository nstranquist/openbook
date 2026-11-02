import { describe, expect, it } from "vitest";
import { BoundedBodyError, readBoundedText } from "./httpBody";

describe("bounded HTTP request bodies", () => {
  it("reads a body below the byte limit", async () => {
    const request = new Request("https://openbook.example.test", {
      method: "POST",
      body: "hello",
    });
    await expect(readBoundedText(request, 5)).resolves.toBe("hello");
  });

  it("rejects an oversized declared length before reading", async () => {
    const request = new Request("https://openbook.example.test", {
      method: "POST",
      body: "small",
      headers: { "Content-Length": "100" },
    });
    await expect(readBoundedText(request, 10)).rejects.toMatchObject({
      status: 413,
      message: "Payload too large",
    } satisfies Partial<BoundedBodyError>);
  });

  it("rejects a body that is larger than its accepted declared length", async () => {
    const request = new Request("https://openbook.example.test", {
      method: "POST",
      body: "123456789",
      headers: { "Content-Length": "2" },
    });
    await expect(readBoundedText(request, 8)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects a chunked body as soon as it crosses the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      },
    });
    const request = new Request("https://openbook.example.test", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedText(request, 8)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an invalid declared length", async () => {
    const request = new Request("https://openbook.example.test", {
      method: "POST",
      body: "small",
      headers: { "Content-Length": "unknown" },
    });
    await expect(readBoundedText(request, 10)).rejects.toMatchObject({ status: 400 });
  });
});
