import type { Metadata } from "next";
import ChatView from "@/components/chat/ChatView";

export const metadata: Metadata = { title: "AI Tutor" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView conversationId={id} />;
}
