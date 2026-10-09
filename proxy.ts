import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;
  // This handler checks the verified session itself and returns JSON 401/403, not a browser redirect.
  if (request.nextUrl.pathname === "/api/analyses" || request.nextUrl.pathname.startsWith("/api/analyses/")) return;
  const { orgId } = await auth.protect();
  if (!orgId && request.nextUrl.pathname !== "/start") {
    return NextResponse.redirect(new URL("/start", request.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
