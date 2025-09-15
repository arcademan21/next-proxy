# Next Proxy

Universal, secure proxy for Next.js. Centralize, audit, and control all external API calls from a single entry point, with support for:

- Security (hides credentials and backend logic)
- Configurable CORS
- Centralized outbound traffic
- Structured auditing and logging
- Request/response transformation
- Access control and validation
- Rate limiting (custom and in-memory included)
- Support for relative endpoints via `baseUrl`

Ideal for projects with multiple external integrations or governance requirements over outbound traffic.

Next Proxy is designed to work seamlessly with the modern, native architecture of Next.js. For optimal performance, security, and maintainability, we recommend combining:

- **Rewrites** in `next.config.js` for declarative route mapping
- **Middleware** for global, centralized logic (auth, rate limiting, logging)
- **next-proxy handler** for advanced, per-endpoint proxy logic

### 1. Route Rewrites (next.config.js)

```js
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: "/api/proxy/:path*",
        destination: "/api/proxy", // All requests go to your handler
      },
    ];
  },
};
```

### 2. Global Middleware (middleware.ts)

```js
// middleware.ts
import { NextResponse } from "next/server";

export function middleware(request) {
  // Example: global authentication
  const token = request.headers.get("authorization");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Add logging, rate limiting, etc. here
  return NextResponse.next();
}

// Apply only to proxy routes
export const config = {
  matcher: ["/api/proxy/:path*"],
};
```

### 3. Centralized Advanced Logic (Handler)

```ts
// app/api/proxy/route.ts
import { nextProxyHandler } from "next-proxy";

export const POST = nextProxyHandler({
  // ...all your advanced options (logging, transform, masking, etc.)
});
```

---

**With this approach you get:**

- Native performance and compatibility (serverless/edge)
- Centralized governance and security
- Advanced proxy logic with minimal code duplication
- Easy maintenance and extensibility

This pattern is fully aligned with the best practices recommended by the Next.js team and the evolution of the framework.

> ⚠️ **Warning: No Turbopack Compatibility**

Next Proxy is fully compatible with Next.js using Webpack. However, Turbopack (the new experimental bundler for Next.js) currently has limitations with local packages, workspaces, and some advanced module resolution patterns. If you experience issues using this package with Turbopack, consider the following options:

- **Recommended:** Force the use of Webpack by adding to your `next.config.js`:
  ```js
  experimental: {
    turbo: false;
  }
  ```
- **If you want to use Turbopack:**
  - Publish the package to npm (even as private) and install it from the registry, not as a local or symlinked package.
  - Avoid cross-dependencies or indirect imports between workspaces.
- **Alternative:** Bundle your module as a single JS file and consume it as a direct dependency.

Turbopack is under active development and will improve over time. For the latest status, see [Vercel Turbopack GitHub](https://github.com/vercel/turbopack).

## Installation

```sh
pnpm add next-proxy
# or
npm install next-proxy
```

## Quick Usage (App Router)

```ts
// app/api/proxy/route.ts
import { nextProxyHandler } from "next-proxy";

export const POST = nextProxyHandler({
  baseUrl: process.env.EXTERNAL_API_BASE,
  allowOrigins: ["http://localhost:3000"],
});
```

---

## Usage with Pages Router

```ts
// pages/api/proxy.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { nextProxyHandler } from "next-proxy";

const handler = nextProxyHandler({ baseUrl: process.env.EXTERNAL_API_BASE });

export default async function proxy(req: NextApiRequest, res: NextApiResponse) {
  // Minimal adapter
  // You may need to create a Request from NextApiRequest if needed
  // App Router is recommended for full compatibility.
  res.status(405).json({ error: "Use App Router for this package" });
}
```

## Combined usage: App Router API + Pages Router frontend

You can use `next-proxy` in an App Router API route and call it from a Pages Router frontend. This is a common and fully supported scenario in Next.js projects.

**API route (App Router):**

```ts
// src/app/api/proxy/route.ts
import { nextProxyHandler } from "next-proxy";

export const POST = nextProxyHandler({
  baseUrl: "https://your-external-backend.com", // your external backend base URL
  allowOrigins: ["http://localhost:3000"], // adjust as needed
  // You can add more options: log, validate, rateLimit, etc.
});
```

**Advanced Example**

```ts
export const POST = nextProxyHandler({
  baseUrl: "https://api.my-service.com",
  allowOrigins: ["http://localhost:3000", "https://app.my-domain.com"],
  inMemoryRate: { windowMs: 60_000, max: 100 },
  log: (e) => console.log("[proxy]", e),
  validate: (req) => req.headers.get("authorization")?.includes("Bearer "),
  transformRequest: ({ method, endpoint, data }) => ({
    method: method ?? "GET",
    endpoint: endpoint.startsWith("/internal")
      ? endpoint.replace("/internal", "/v2")
      : endpoint,
    data,
  }),
  transformResponse: (res) => ({ ...res, proxiedAt: new Date().toISOString() }),
  maskSensitiveData: (data) => {
    if (!data) return data;
    if (data.password) return { ...data, password: "***" };
    return data;
  },
});
```

In a React component (e.g. `src/pages/index.tsx`), you should use a hook like `useEffect` to make the request after the component mounts:

```tsx
import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    const fetchData = async () => {
      const req = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "GET",
          endpoint: "/v1/health", // relative endpoint, will be resolved with baseUrl
        }),
      });
      const res = await req.json();
    };
    fetchData();
  }, []);

  return (
    <div>
      <h1>Home page</h1>
    </div>
  );
}
```

This pattern allows you to keep your API logic in the App Router (recommended for new Next.js projects) while using the classic Pages Router for your frontend. Both approaches work together seamlessly.

## Full Options

| Option              | Type                                | Description                                    |
| ------------------- | ----------------------------------- | ---------------------------------------------- |
| `log`               | `(info) => void`                    | Receives events: request, response, error.     |
| `validate`          | `(req) => boolean \| Promise`       | Allows to block flow (auth, permissions).      |
| `transformRequest`  | `({method,endpoint,data}) => {...}` | Modifies payload before fetch.                 |
| `transformResponse` | `(res) => any`                      | Adjusts the response before sending to client. |
| `rateLimit`         | `(req) => boolean \| Promise`       | Custom external rate limiting.                 |
| `inMemoryRate`      | `{ windowMs, max, key? }`           | Simple in-memory rate limiting.                |
| `allowOrigins`      | `string[]`                          | CORS whitelist.                                |
| `onCorsDenied`      | `(origin) => any`                   | Custom response for denied CORS.               |
| `maskSensitiveData` | `(data) => any`                     | Sanitizes data before sending.                 |
| `baseUrl`           | `string`                            | Prefix for relative endpoints.                 |

## CORS and Preflight

Automatically responds to `OPTIONS` with headers configured according to `allowOrigins`.

## In-memory Rate Limiting

Minimal configuration:

```ts
inMemoryRate: { windowMs: 15_000, max: 20 }
```

Grouping is by IP (`req.ip`) or you can define `key: (req) => 'user:'+id`.

## Common Errors

| Message                             | Cause                                    | Solution                     |
| ----------------------------------- | ---------------------------------------- | ---------------------------- |
| `Relative endpoint without baseUrl` | Used relative endpoint without `baseUrl` | Define `baseUrl` in options  |
| `Origin not allowed`                | CORS blocked                             | Add origin to `allowOrigins` |
| `Rate limit exceeded`               | Limit reached                            | Increase `max` or window     |

# Comparison: next-proxy vs other Next.js proxy solutions

Next.js offers several ways to proxy API requests. Here’s when to use each approach:

| Solution                       | Use Case                                                  | Limitations                                |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------ |
| **Rewrites (next.config.js)**  | Simple path forwarding, development, no logic needed      | Cannot modify headers, no auth, no logging |
| **http-proxy / middleware**    | Custom API routes, can modify requests, more control      | More boilerplate, not native to App Router |
| **next-http-proxy-middleware** | Simplifies http-proxy usage in API routes                 | Still requires custom route, less flexible |
| **@navikt/next-api-proxy**     | Advanced token exchange, enterprise security              | Complex setup, focused on auth scenarios   |
| **next-proxy (this package)**  | Centralized, configurable, minimal, works with App Router | Not for legacy custom servers              |

## Why use next-proxy?

- Native integration with App Router and Pages Router
- Centralized logic: CORS, logging, rate limiting, request/response transformation, access control
- Minimal dependencies, clean API, easy to maintain
- Ideal for projects needing governance, security, and audit over outbound traffic

If you only need simple path forwarding for development, rewrites are enough. For production, security, and advanced logic, use next-proxy.

## License

<a href="https://github.com/arcademan21/next-proxy/blob/main/LICENSE">MIT</a>
