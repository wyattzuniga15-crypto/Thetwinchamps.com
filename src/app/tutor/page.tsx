import type { Metadata } from "next";
import NewChatLauncher from "@/components/chat/NewChatLauncher";

export const metadata: Metadata = { title: "AI Tutor" };

const SUGGESTIONS = [
  "Help me solve 2x + 7 = 19 step by step",
  "Explain photosynthesis like I'm in 6th grade",
  "Give me feedback on a paragraph I wrote",
  "What caused World War I?",
  "Quiz me on Spanish vocabulary basics",
  "Teach me how fractions work with examples",
];

export default function TutorPage() {
  return <NewChatLauncher suggestions={SUGGESTIONS} />;
}
