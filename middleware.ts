import { NextResponse } from "next/server";

export function middleware(request: Request) {
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
