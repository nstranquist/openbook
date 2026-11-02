export class BoundedBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "BoundedBodyError";
  }
}

export async function readBoundedText(request: Request, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("The request body limit must be a positive integer");
  }
  const declaredText = request.headers.get("content-length");
  if (declaredText !== null) {
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      throw new BoundedBodyError("Invalid Content-Length", 400);
    }
    if (declared > maximumBytes) {
      throw new BoundedBodyError("Payload too large", 413);
    }
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > maximumBytes) {
        throw new BoundedBodyError("Payload too large", 413);
      }
      return text;
    } catch (error) {
      if (error instanceof BoundedBodyError) throw error;
      throw new BoundedBodyError("Could not read request body", 400);
    }
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += part.value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedBodyError("Payload too large", 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof BoundedBodyError) throw error;
    throw new BoundedBodyError("Could not read request body", 400);
  } finally {
    reader.releaseLock();
  }
}
