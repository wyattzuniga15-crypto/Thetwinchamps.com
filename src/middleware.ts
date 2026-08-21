import { NextRequest, NextResponse } from "next/server";

/** Assigns the anonymous user-id cookie on first visit so server components can read it. */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const existing = req.cookies.get("tutor_uid")?.value;
  if (!existing || !/^[0-9a-f-]{36}$/.test(existing)) {
    res.cookies.set("tutor_uid", crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365 * 2,
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
