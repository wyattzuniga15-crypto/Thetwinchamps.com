import { cookies } from "next/headers";
import { ensureUser } from "./db";

/**
 * Lightweight identity: each browser gets an anonymous user id in an httpOnly
 * cookie. Every table is keyed by user_id, so plugging in real authentication
 * later only means swapping how this id is derived.
 */

const COOKIE = "tutor_uid";

export async function getUserId(): Promise<string> {
  const store = await cookies();
  let id = store.get(COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    try {
      store.set(COOKIE, id, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365 * 2,
        path: "/",
      });
    } catch {
      // cookies() is read-only inside server components; middleware sets it there.
    }
  }
  ensureUser(id);
  return id;
}
