import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-20 text-center">
      <div className="text-5xl">🔍</div>
      <h1 className="mt-4 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-ink-muted">That page doesn&apos;t exist — but there&apos;s plenty to learn.</p>
      <Link
        href="/"
        className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90"
      >
        Back to home
      </Link>
    </div>
  );
}
