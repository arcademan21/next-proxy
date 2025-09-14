declare module "next/server" {
  export interface NextRequest {
    headers: Headers;
    method: string;
    json(): Promise<any>;
  }
  export class NextResponse {
    constructor(body?: BodyInit | null, init?: ResponseInit);
    static json(data: any, init?: ResponseInit): NextResponse;
  }
}
