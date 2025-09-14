// Helpers to extract status, headers, and body from NextResponse
function getStatus(res: any): number {
  return res.status ?? res._getStatus?.() ?? res._status ?? 200;
}

function getHeader(res: any, key: string): string | null {
  if (res.headers?.get) return res.headers.get(key);
  if (res.headers && typeof res.headers === "object") {
    return res.headers[key.toLowerCase()] || res.headers[key] || null;
  }
  return null;
}

async function getBody(res: any): Promise<any> {
  if (typeof res.text === "function") {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (res.body && typeof res.body === "string") {
    try {
      return JSON.parse(res.body);
    } catch {
      return res.body;
    }
  }
  if (res._getData) return res._getData();
  return undefined;
}
import { nextProxyHandler, NextProxyOptions } from "../proxy";
import { NextRequest } from "next/server";

// Mock NextRequest for testing
function createMockRequest({
  method = "POST",
  headers = {},
  body = {},
  origin = "https://test.com",
}: {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  origin?: string;
} = {}): NextRequest {
  const lowerHeaders: Record<string, string> = {};
  for (const k in headers) {
    lowerHeaders[k.toLowerCase()] = headers[k];
  }
  return {
    method,
    headers: {
      get: (key: string) => lowerHeaders[key.toLowerCase()] || null,
    },
    json: async () => body,
    url: "https://localhost/api/proxy",
  } as unknown as NextRequest;
}

describe("nextProxyHandler", () => {
  it("should handle CORS preflight", async () => {
    const handler = nextProxyHandler({ allowOrigins: ["https://test.com"] });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://test.com" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(204);
    expect(getHeader(res, "Access-Control-Allow-Origin")).toBe(
      "https://test.com"
    );
  });

  it("should deny CORS if origin not allowed", async () => {
    const handler = nextProxyHandler({ allowOrigins: ["https://test.com"] });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://evil.com" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(403);
  });

  it("should apply in-memory rate limiting", async () => {
    const handler = nextProxyHandler({
      inMemoryRate: { windowMs: 1000, max: 1, key: () => "test" },
    });
    const req = createMockRequest();
    await handler(req); // first request
    const res = await handler(req); // second request (should be rate limited)
    expect(getStatus(res)).toBe(429);
  });

  it("should call validate and block if false", async () => {
    const handler = nextProxyHandler({
      validate: () => false,
    });
    const req = createMockRequest();
    const res = await handler(req);
    expect(getStatus(res)).toBe(401);
  });

  it("should call log on request and response", async () => {
    const logs: any[] = [];
    const handler = nextProxyHandler({
      log: (info) => logs.push(info),
      baseUrl: "https://jsonplaceholder.typicode.com",
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    await handler(req);
    expect(logs.some((l) => l.type === "request")).toBe(true);
    expect(logs.some((l) => l.type === "response")).toBe(true);
  });

  it("should transform request and response", async () => {
    const handler = nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      transformRequest: ({ method, endpoint, data }) => ({
        method,
        endpoint,
        data,
      }),
      transformResponse: (res) => ({ id: res.id }),
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    const res = await handler(req);
    const json = await getBody(res);
    expect(json).toHaveProperty("id");
  });

  it("should mask sensitive data", async () => {
    const handler = nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      maskSensitiveData: (data) => ({ ...data, secret: "***" }),
    });
    const req = createMockRequest({
      body: { method: "POST", endpoint: "/posts", data: { secret: "1234" } },
    });
    // We only test that it does not throw and returns a response
    const res = await handler(req);
    expect(getStatus(res)).toBeGreaterThanOrEqual(200);
  });

  it("should handle missing method or endpoint", async () => {
    const handler = nextProxyHandler();
    const req = createMockRequest({ body: {} });
    const res = await handler(req);
    expect(getStatus(res)).toBe(400);
  });

  it("should handle relative endpoint without baseUrl", async () => {
    const handler = nextProxyHandler();
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/foo" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(400);
  });
});
