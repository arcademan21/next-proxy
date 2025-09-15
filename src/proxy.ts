/**
 * Next Proxy - Universal API Proxy for Next.js
 * Security, CORS, centralization, logging, request/response transformation, and access control.
 * @author Haroldy Arturo Pérez Rodríguez - ArcadeMan <haroldyarturo@gmail.com>
 * @license MIT
 */

// Next.js types
import { NextRequest, NextResponse } from "next/server";

// HTTP methods that do not have a body
const WITHOUT_BODY = ["GET", "HEAD"];

// Options for the proxy handler
export interface NextProxyOptions {
  /** Logging callback for request/response/error events */
  log?: (info: Record<string, any>) => void;
  /** Pre-validation (auth, permissions, etc.) */
  validate?: (req: NextRequest) => Promise<boolean> | boolean;
  /** Transform input data (method, endpoint, data) before proxying */
  transformRequest?: (payload: {
    method: string;
    endpoint: string;
    data: any;
  }) => { method?: string; endpoint?: string; data?: any } | void;
  /** Transform the response before returning to the client */
  transformResponse?: (res: any) => any;
  /** External rate limiting (true = allowed) */
  rateLimit?: (req: NextRequest) => Promise<boolean> | boolean;
  /** Allowed origins for CORS */
  allowOrigins?: string[];
  /** Mask sensitive data before sending */
  maskSensitiveData?: (data: any) => any;
  /** Base URL for relative endpoints */
  baseUrl?: string;
  /** Custom response when origin is not allowed */
  onCorsDenied?: (origin: string) => any;
  /** In-memory rate limiter implementation */
  inMemoryRate?: {
    windowMs: number; // window in ms
    max: number; // max requests per window
    key?: (req: NextRequest) => string; // how to identify the client
  };
}

// Internal state for in-memory rate limiting
interface InternalRateState {
  count: number;
  expires: number;
}

// Simple in-memory store for rate limiting
const rateStore: Map<string, InternalRateState> = new Map();

/**
 * Apply in-memory rate limiting
 * @param req The NextRequest object
 * @param cfg The rate limiting configuration
 * @returns True if the request is allowed, false if rate limited
 */
function applyInMemoryRate(
  req: NextRequest,
  cfg: NonNullable<NextProxyOptions["inMemoryRate"]>
): boolean {
  const key = cfg.key ? cfg.key(req) : getClientIp(req);
  const now = Date.now();
  const current = rateStore.get(key);
  if (!current || current.expires < now) {
    rateStore.set(key, { count: 1, expires: now + cfg.windowMs });
    return true;
  }
  if (current.count >= cfg.max) return false;
  current.count += 1;
  return true;
}

/** Get client IP from request headers or connection info
 * @param req The NextRequest object
 * @returns The client IP as a string
 */
function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  // @ts-ignore acceso interno no tipado en modo Node runtime
  const nodeReq = (req as any)?._req; // best effort
  return nodeReq?.socket?.remoteAddress || "anon";
}

/**
 * Universal handler for proxying API requests in Next.js
 * @param options Advanced options for logging, validation, transformation, etc.
 */
export function nextProxyHandler(options: NextProxyOptions = {}) {
  return async function handler(req: NextRequest) {
    const origin = req.headers.get("origin") || "";

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      if (options.allowOrigins && !options.allowOrigins.includes(origin)) {
        const denied = options.onCorsDenied?.(origin) || {
          error: "Origin not allowed",
        };
        return new NextResponse(JSON.stringify(denied), {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
          },
        });
      }
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
        },
      });
    }

    if (options.allowOrigins && !options.allowOrigins.includes(origin)) {
      const denied = options.onCorsDenied?.(origin) || {
        error: "Origin not allowed",
      };
      return NextResponse.json(denied, { status: 403 });
    }

    // In-memory rate limiting if configured
    if (options.inMemoryRate && !applyInMemoryRate(req, options.inMemoryRate)) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    // External/custom rate limiting
    if (options.rateLimit && !(await options.rateLimit(req))) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    // Custom validation (auth, permissions, etc.)
    if (options.validate && !(await options.validate(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Log request event
    if (options.log)
      options.log({ type: "request", method: req.method, origin });

    try {
      const token = req.headers.get("Authorization");
      let payload: any = {};
      try {
        payload = await req.json();
      } catch {
        /* ignore empty body */
      }
      let { method, endpoint, data } = payload;

      if (options.transformRequest) {
        const transformed =
          options.transformRequest({ method, endpoint, data }) || {};
        method = transformed.method ?? method;
        endpoint = transformed.endpoint ?? endpoint;
        data = transformed.data ?? data;
      }

      if (!method || !endpoint) {
        return NextResponse.json(
          { error: "Missing method or endpoint" },
          { status: 400 }
        );
      }

      // Resolve relative endpoints using baseUrl
      if (!/^https?:\/\//i.test(endpoint)) {
        if (!options.baseUrl) {
          return NextResponse.json(
            { error: "Relative endpoint without baseUrl" },
            { status: 400 }
          );
        }
        endpoint =
          options.baseUrl.replace(/\/$/, "") +
          "/" +
          endpoint.replace(/^\//, "");
      }

      // Mask sensitive data if configured
      if (options.maskSensitiveData) {
        data = options.maskSensitiveData(data);
      }

      const upperMethod = method.toUpperCase();
      const fetchOptions: RequestInit = { method: upperMethod };
      const headers: Record<string, string> = {};
      if (token)
        headers["Authorization"] = token.startsWith("Bearer")
          ? token
          : `Bearer ${token}`;
      if (!WITHOUT_BODY.includes(upperMethod)) {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(data ?? {});
      }
      if (Object.keys(headers).length) fetchOptions.headers = headers;

      // Proxy the request to the external endpoint
      const started = Date.now();
      const upstream = await fetch(endpoint, fetchOptions);
      const durationMs = Date.now() - started;

      // Parse the response as JSON, text, or fallback to binary
      let response: any;
      try {
        response = await upstream.json();
      } catch {
        try {
          response = await upstream.text();
        } catch {
          const buffer = await upstream.arrayBuffer();
          response = {
            message: "Unprocessable response (binary)",
            length: buffer.byteLength,
          };
        }
      }

      // Transform the response if configured
      if (options.transformResponse)
        response = options.transformResponse(response);

      // Log response event
      if (options.log)
        options.log({
          type: "response",
          status: upstream.status,
          durationMs,
          endpoint,
        });

      if (!upstream.ok)
        return NextResponse.json(response, { status: upstream.status });
      return NextResponse.json(response, {
        headers: options.allowOrigins
          ? { "Access-Control-Allow-Origin": origin }
          : undefined,
      });
    } catch (error: any) {
      // Log error event
      if (options.log)
        options.log({ type: "error", error: error?.message || String(error) });
      return NextResponse.json(
        { error: error?.message || String(error) },
        { status: 500 }
      );
    }
  };
}

// Default export for convenience
export default nextProxyHandler;

// --- DEV NOTES ---
// 1. Ensure all request and response transformations are properly typed.
// 2. Consider adding more detailed logging for debugging purposes.
// 3. Review CORS handling to support more complex scenarios.
// 4. Implement additional security measures as needed.
