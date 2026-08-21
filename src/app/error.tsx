"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-20 text-center">
      <div className="text-5xl">😵</div>
      <h1 className="mt-4 text-xl font-semibold">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-ink-muted">
        An unexpected error occurred. Your data is safe — try again.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
