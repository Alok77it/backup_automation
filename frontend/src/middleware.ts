import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const welcomeDisabled =
    process.env.DISABLE_WELCOME === "true" ||
    process.env.NEXT_PUBLIC_DISABLE_WELCOME === "true";

  if (welcomeDisabled) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/welcome", "/welcome/:path*"],
};
