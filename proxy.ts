import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/preview",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/__clerk(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;
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
