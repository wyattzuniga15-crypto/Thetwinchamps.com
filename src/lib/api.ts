import { NextResponse } from "next/server";

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T = any>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
