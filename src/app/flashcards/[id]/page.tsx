import type { Metadata } from "next";
import DeckClient from "./DeckClient";

export const metadata: Metadata = { title: "Flashcards" };

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DeckClient deckId={id} />;
}
