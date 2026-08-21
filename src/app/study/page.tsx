import type { Metadata } from "next";
import StudyClient from "./StudyClient";

export const metadata: Metadata = { title: "Study Mode" };

export default function StudyPage() {
  return <StudyClient />;
}
