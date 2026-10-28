import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie → sign-in with a return path. Every protected page,
 * Server Action and route still verifies the session and roles on the server (src/lib/session.ts).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request, { cookiePrefix: "vpk" })) return NextResponse.next();
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
