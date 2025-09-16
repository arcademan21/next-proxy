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
import { nextProxyHandler, NextProxyOptions } from "../src/proxy";
import type { ProxyRequestPayload, ProxyResponsePayload } from "../src/proxy";
// Definición local mínima de NextRequest para pruebas, igual que en proxy.ts
type NextRequest = {
  method: string;
  headers: Headers;
  json(): Promise<any>;
  url: string;
};

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
  const realHeaders = new Headers(headers);
  // Only set origin if not already present
  if (origin && !realHeaders.has("origin")) realHeaders.set("origin", origin);
  return {
    method,
    headers: realHeaders,
    json: async () => body,
    url: "https://localhost/api/proxy",
  } as unknown as NextRequest;
}

describe("nextProxyHandler", () => {
  it("should block unauthorized requests with auth", async () => {
    const handler = await nextProxyHandler({
      auth: () => false,
    });
    const req = createMockRequest();
    const res = await handler(req);
    expect(getStatus(res)).toBe(401);
    const body = await getBody(res);
    expect(body.error).toMatch(/auth/i);
  });

  it("should allow authorized requests with auth", async () => {
    const handler = await nextProxyHandler({
      auth: () => true,
      baseUrl: "https://jsonplaceholder.typicode.com",
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBeGreaterThanOrEqual(200);
  });

  it("should block requests with failed csrf", async () => {
    const handler = await nextProxyHandler({
      csrf: () => false,
    });
    const req = createMockRequest();
    const res = await handler(req);
    expect(getStatus(res)).toBe(403);
    const body = await getBody(res);
    expect(body.error).toMatch(/csrf/i);
  });

  it("should allow requests with passed csrf", async () => {
    const handler = await nextProxyHandler({
      csrf: () => true,
      baseUrl: "https://jsonplaceholder.typicode.com",
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBeGreaterThanOrEqual(200);
  });

  it("should sanitize data before sending", async () => {
    let sanitized = false;
    const handler = await nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      sanitize: (data) => {
        sanitized = true;
        return Object.assign(
          {},
          typeof data === "object" && data !== null ? data : {},
          { safe: true }
        );
      },
    });
    const req = createMockRequest({
      body: { method: "POST", endpoint: "/posts", data: { foo: "bar" } },
    });
    await handler(req);
    expect(sanitized).toBe(true);
  });

  it("should call monitor on response", async () => {
    let called = false;
    const handler = await nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      monitor: (req, res) => {
        called = true;
        expect(req).toBeDefined();
        expect(res).toBeDefined();
      },
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    await handler(req);
    expect(called).toBe(true);
  });
  it("should allow all origins with wildcard", async () => {
    const handler = await nextProxyHandler({ allowOrigins: "*" });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://anything.com" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(204);
    expect(getHeader(res, "Access-Control-Allow-Origin")).toBe(
      "https://anything.com"
    );
  });

  it("should allow origin by function", async () => {
    const handler = await nextProxyHandler({
      allowOrigins: (origin) => origin.endsWith(".trusted.com"),
    });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://api.trusted.com" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(204);
    expect(getHeader(res, "Access-Control-Allow-Origin")).toBe(
      "https://api.trusted.com"
    );
    // Should deny untrusted
    const req2 = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://evil.com" },
    });
    const res2 = await handler(req2);
    expect(getStatus(res2)).toBe(403);
  });

  it("should set custom CORS methods and headers", async () => {
    const handler = await nextProxyHandler({
      allowOrigins: ["https://test.com"],
      corsMethods: ["GET", "POST"],
      corsHeaders: ["X-Custom", "Authorization"],
    });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://test.com" },
    });
    const res = await handler(req);
    expect(getHeader(res, "Access-Control-Allow-Methods")).toBe("GET,POST");
    expect(getHeader(res, "Access-Control-Allow-Headers")).toBe(
      "X-Custom, Authorization"
    );
  });
  it("should handle CORS preflight", async () => {
    const handler = await nextProxyHandler({
      allowOrigins: ["https://test.com"],
    });
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
    const handler = await nextProxyHandler({
      allowOrigins: ["https://test.com"],
    });
    const req = createMockRequest({
      method: "OPTIONS",
      headers: { origin: "https://evil.com" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(403);
  });

  it("should apply in-memory rate limiting", async () => {
    const handler = await nextProxyHandler({
      inMemoryRate: { windowMs: 1000, max: 1, key: () => "test" },
    });
    const req = createMockRequest();
    await handler(req); // first request
    const res = await handler(req); // second request (should be rate limited)
    expect(getStatus(res)).toBe(429);
  });

  it("should call validate and block if false", async () => {
    const handler = await nextProxyHandler({
      validate: () => false,
    });
    const req = createMockRequest();
    const res = await handler(req);
    expect(getStatus(res)).toBe(401);
  });

  it("should call log on request and response", async () => {
    const logs: any[] = [];
    const handler = await nextProxyHandler({
      log: (info) => logs.push(info),
      baseUrl: "https://jsonplaceholder.typicode.com",
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    await handler(req);
    // Validar campos clave en los logs
    const requestLog = logs.find((l) => l.type === "request");
    const responseLog = logs.find((l) => l.type === "response");
    expect(requestLog).toBeDefined();
    expect(responseLog).toBeDefined();
    expect(typeof requestLog.timestamp).toBe("string");
    expect(requestLog.level).toBe("info");
    expect(typeof requestLog.ip).toBe("string");
    expect(requestLog.method).toBe("POST");
    expect(requestLog.origin).toBe("https://test.com");
    expect(typeof responseLog.timestamp).toBe("string");
    expect(responseLog.level).toBe("info");
    expect(typeof responseLog.ip).toBe("string");
    expect(responseLog.status).toBeGreaterThanOrEqual(200);
    expect(responseLog.endpoint).toBe(
      "https://jsonplaceholder.typicode.com/todos/1"
    );
    expect(responseLog.payload).toBeDefined();
  });

  it("should transform request and response", async () => {
    const handler = await nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      transformRequest: ({ method, endpoint, data }: ProxyRequestPayload) => ({
        method,
        endpoint,
        data,
      }),
      transformResponse: (res: ProxyResponsePayload) => ({ id: res.id }),
    });
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/todos/1" },
    });
    const res = await handler(req);
    const json = await getBody(res);
    expect(json).toHaveProperty("id");
  });

  it("should mask sensitive data", async () => {
    const handler = await nextProxyHandler({
      baseUrl: "https://jsonplaceholder.typicode.com",
      maskSensitiveData: (data) =>
        Object.assign(
          {},
          typeof data === "object" && data !== null ? data : {},
          { secret: "***" }
        ),
    });
    const req = createMockRequest({
      body: { method: "POST", endpoint: "/posts", data: { secret: "1234" } },
    });
    // We only test that it does not throw and returns a response
    const res = await handler(req);
    expect(getStatus(res)).toBeGreaterThanOrEqual(200);
  });

  it("should handle missing method or endpoint", async () => {
    const handler = await nextProxyHandler();
    const req = createMockRequest({ body: {} });
    const res = await handler(req);
    expect(getStatus(res)).toBe(400);
  });

  it("should handle relative endpoint without baseUrl", async () => {
    const handler = await nextProxyHandler();
    const req = createMockRequest({
      body: { method: "GET", endpoint: "/foo" },
    });
    const res = await handler(req);
    expect(getStatus(res)).toBe(400);
  });
});
