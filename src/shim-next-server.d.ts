/**
 * This file is a shim for the Next.js server types.
 * It provides minimal type definitions to allow development and compilation of the package.
 * These types are NOT complete and should be overridden by the official Next.js types in a real project.
 */
declare module "next/server" {
  export interface NextRequest {
    headers: Headers;
    method: string;
    json(): Promise<any>;
  }
  export class NextResponse {
    static next: any;
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json(data: any, init?: ResponseInit): NextResponse;
  }
}
