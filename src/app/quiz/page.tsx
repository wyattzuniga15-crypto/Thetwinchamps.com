import type { Metadata } from "next";
import { Suspense } from "react";
import QuizClient from "./QuizClient";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Quiz" };

export default function QuizPage() {
  return (
    <Suspense fallback={<Spinner label="Loading quiz…" />}>
      <QuizClient />
    </Suspense>
  );
}
