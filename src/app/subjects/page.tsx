import type { Metadata } from "next";
import { Suspense } from "react";
import SubjectsClient from "./SubjectsClient";
import { Spinner } from "@/components/ui";

export const metadata: Metadata = { title: "Subjects" };

export default function SubjectsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading subjects…" />}>
      <SubjectsClient />
    </Suspense>
  );
}
