// Minimal ambient type shims to allow importing 'next/server' when developing this package
// These are NOT full Next.js types. When used inside a real Next.js project, official types override these.

declare module "next/server" {
  export interface NextRequest {
    method: string;
    headers: {
      get(name: string): string | null;
    };
    json(): Promise<any>;
    url: string;
  }
  export class NextResponse {
    static json(
      body: any,
      init?: { status?: number; headers?: Record<string, string> }
    ): any;
    constructor(
      body?: any,
      init?: { status?: number; headers?: Record<string, string> }
    );
  }
}
