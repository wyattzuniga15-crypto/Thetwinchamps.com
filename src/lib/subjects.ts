export interface Subject {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  topics: string[];
}

export const SUBJECTS: Subject[] = [
  {
    slug: "english",
    name: "English",
    emoji: "📚",
    description: "Grammar, literature, essays, and language arts",
    topics: ["Grammar & punctuation", "Essay writing", "Literary analysis", "Reading comprehension", "Vocabulary building"],
  },
  {
    slug: "math",
    name: "Mathematics",
    emoji: "➗",
    description: "From arithmetic and fractions to calculus and statistics",
    topics: ["Fractions & decimals", "Algebra", "Geometry", "Trigonometry", "Calculus", "Statistics & probability"],
  },
  {
    slug: "science",
    name: "Science",
    emoji: "🔬",
    description: "Biology, chemistry, physics, and earth science",
    topics: ["Biology & genetics", "Chemistry", "Physics", "Earth science", "Astronomy", "Scientific method"],
  },
  {
    slug: "history",
    name: "History",
    emoji: "🏛️",
    description: "U.S. and world history, civics, and government",
    topics: ["U.S. history", "World history", "Ancient civilizations", "Government & civics", "Economics"],
  },
  {
    slug: "geography",
    name: "Geography",
    emoji: "🌎",
    description: "Countries, physical geography, maps, and cultures",
    topics: ["World countries & capitals", "Physical geography", "Climate & biomes", "Human geography"],
  },
  {
    slug: "cs",
    name: "Computer Science",
    emoji: "💻",
    description: "Programming, algorithms, and how computers work",
    topics: ["Programming basics", "Python", "JavaScript", "Algorithms & data structures", "How the internet works"],
  },
  {
    slug: "reading",
    name: "Reading",
    emoji: "📖",
    description: "Comprehension, analysis, and reading strategies",
    topics: ["Main idea & details", "Inference", "Author's purpose", "Summarizing", "Context clues"],
  },
  {
    slug: "writing",
    name: "Writing",
    emoji: "✍️",
    description: "Essays, creative writing, and clear communication",
    topics: ["Paragraph structure", "Persuasive essays", "Narrative writing", "Research papers", "Editing & revising"],
  },
  {
    slug: "languages",
    name: "Languages",
    emoji: "🌐",
    description: "Spanish, French, and other foreign languages",
    topics: ["Spanish", "French", "German", "Vocabulary practice", "Conversation basics"],
  },
  {
    slug: "general",
    name: "General Knowledge",
    emoji: "🧠",
    description: "Study skills, test prep, research, and everything else",
    topics: ["Study techniques", "Test preparation", "Note taking", "Research skills", "Critical thinking"],
  },
];

export function getSubject(slug: string): Subject | undefined {
  return SUBJECTS.find((s) => s.slug === slug);
}

export function subjectName(slug: string): string {
  return getSubject(slug)?.name || slug || "General";
}
