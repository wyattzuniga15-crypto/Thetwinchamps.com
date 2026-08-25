import type { Metadata } from "next";
import MathClient from "./MathClient";

export const metadata: Metadata = {
  title: "Math Mode",
  description: "Instant answers and worked steps for arithmetic, algebra, percents, and number theory.",
};

export default function MathPage() {
  return <MathClient />;
}
