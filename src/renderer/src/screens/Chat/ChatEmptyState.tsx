import { memo } from "react";
import { Code, PenLine, Lightbulb, BookOpen, Terminal } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { MorphingText } from "../../components/ui/MorphingText";

const MORPH_PHRASES_PT = [
  "O que vamos construir hoje?",
  "Qual o próximo passo?",
  "Posso ler, editar, executar.",
  "Diga e eu faço.",
  "Pronto pra começar.",
];

const MORPH_PHRASES_EN = [
  "What are we building today?",
  "What's next?",
  "I can read, edit, run.",
  "Just say it and I'll do it.",
  "Ready to ship.",
];

interface Chip {
  label: string;
  Icon: typeof Code;
  text: string;
}

const CHIPS: Chip[] = [
  { label: "Código", Icon: Code, text: "Write a Python script to rename all files in a folder" },
  { label: "Criar", Icon: PenLine, text: "Help me draft a project proposal for a new feature" },
  { label: "Estratégias", Icon: Lightbulb, text: "What are the best strategies for scaling a backend API?" },
  { label: "Escrever", Icon: BookOpen, text: "Write a clear technical documentation for this module" },
  { label: "Terminal", Icon: Terminal, text: "Schedule a cron job to back up my database every night" },
];

// Asterisk SVG — 8 raios, estilo minimalista
const AsteriskIcon = (): React.JSX.Element => (
  <svg
    width="52"
    height="52"
    viewBox="0 0 52 52"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="hero-asterisk"
    aria-hidden="true"
  >
    <line x1="26" y1="5" x2="26" y2="47" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="5" y1="26" x2="47" y2="26" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="10.2" y1="10.2" x2="41.8" y2="41.8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    <line x1="41.8" y1="10.2" x2="10.2" y2="41.8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

interface ChatEmptyStateProps {
  onSelectSuggestion: (text: string) => void;
}

export const ChatEmptyState = memo(function ChatEmptyState({
  onSelectSuggestion,
}: ChatEmptyStateProps): React.JSX.Element {
  const { locale } = useI18n();
  const morphPhrases = locale.startsWith("pt") ? MORPH_PHRASES_PT : MORPH_PHRASES_EN;

  return (
    <div className="chat-empty chat-hero">
      <div className="chat-hero-symbol">
        <AsteriskIcon />
      </div>

      <h1 className="chat-hero-title">
        <MorphingText words={morphPhrases} interval={3200} />
      </h1>

      <div className="chat-hero-chips">
        {CHIPS.map(({ label, Icon, text }) => (
          <button
            key={label}
            className="chat-hero-chip"
            onClick={() => onSelectSuggestion(text)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
});
