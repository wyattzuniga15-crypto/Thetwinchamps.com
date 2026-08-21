import type { Metadata } from "next";
import { Suspense } from "react";
import FlashcardsClient from "./FlashcardsClient";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Flashcards" };

export default function FlashcardsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading flashcards…" />}>
      <FlashcardsClient />
    </Suspense>
  );
}
