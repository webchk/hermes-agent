/**
 * MorphingText — adapted from the prompt snippet (Souza/JS).
 *
 * Cycles through a list of phrases with a per-character "morph out → morph
 * in" effect. Used in spots that benefit from constant-but-subtle motion
 * (empty chat state, splash screen) without becoming distracting.
 *
 * Differences from the upstream snippet:
 *   - No Tailwind: gradient + cursor styled via `.morphing-text-*` classes
 *     in main.css.
 *   - No `cn` helper: className composition is a plain template literal.
 *   - Cleans the interval *and* the timeout in the same effect so unmount
 *     while morphing doesn't leak a half-finished step.
 *   - `morphProgress` removed (unused; reduced one render per tick).
 */
import { useEffect, useState } from "react";

interface MorphingTextProps {
  words: string[];
  className?: string;
  /** Time each finished word stays visible before morphing to the next (ms). */
  interval?: number;
  /** Total duration of one morph transition (ms). Default 800. */
  morphDuration?: number;
  /** Append a blinking cursor at the end. Default true. */
  cursor?: boolean;
}

export function MorphingText({
  words,
  className,
  interval = 3000,
  morphDuration = 800,
  cursor = true,
}: MorphingTextProps): React.JSX.Element {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayText, setDisplayText] = useState(words[0] || "");

  const currentWord = words[currentIndex] || "";
  const nextWord = words[(currentIndex + 1) % words.length] || "";

  useEffect(() => {
    if (!words.length || words.length < 2) {
      setDisplayText(words[0] || "");
      return;
    }

    const steps = 20;
    let step = 0;

    const morphInterval = setInterval(() => {
      step++;
      const progress = step / steps;

      if (progress < 0.5) {
        // Morph out — chop characters off the current word
        const charCount = Math.floor(currentWord.length * (1 - progress * 2));
        setDisplayText(currentWord.slice(0, charCount));
      } else {
        // Morph in — type characters of the next word
        const charCount = Math.floor(nextWord.length * ((progress - 0.5) * 2));
        setDisplayText(nextWord.slice(0, charCount));
      }

      if (step >= steps) {
        clearInterval(morphInterval);
        setDisplayText(nextWord);
      }
    }, morphDuration / steps);

    const wordTimeout = setTimeout(() => {
      setCurrentIndex((idx) => (idx + 1) % words.length);
    }, interval);

    return () => {
      clearInterval(morphInterval);
      clearTimeout(wordTimeout);
    };
  }, [currentIndex, currentWord, nextWord, interval, morphDuration, words]);

  return (
    <span className={`morphing-text ${className || ""}`.trim()}>
      <span className="morphing-text-gradient">{displayText}</span>
      {cursor && <span className="morphing-text-cursor" aria-hidden="true" />}
    </span>
  );
}

export default MorphingText;
