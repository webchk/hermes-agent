/**
 * TextScramble — Souza/JS, adapted from the prompt-engineered component.
 *
 * Used by ActivityFeed.tsx to animate phase labels while a task is running
 * (e.g. "Pensando...", "Lendo arquivos...", "Executando comando..."). The
 * scramble effect gives a Claude Code-style "the agent is doing something
 * right now" feel without depending on the LLM emitting any specific text.
 *
 * Differences from the source snippet:
 *   - We don't ship Tailwind in this Electron app, so styling stays via
 *     `className` (resolved by main.css) — no Tailwind class names are
 *     hard-coded inside the component.
 *   - `useEffect` cleans up the interval on unmount so React doesn't warn
 *     in StrictMode and we don't leak timers when a row finishes.
 *   - Imports from `motion/react` (framer-motion's React-19-compatible
 *     entry point) but falls back to `framer-motion` via a re-export shim
 *     so we don't have to bump the dep choice from the upstream snippet.
 */
import { type JSX, useEffect, useRef, useState } from "react";
import { motion, type MotionProps } from "framer-motion";

type TextScrambleProps = {
  children: string;
  duration?: number;
  speed?: number;
  characterSet?: string;
  as?: React.ElementType;
  className?: string;
  trigger?: boolean;
  onScrambleComplete?: () => void;
} & MotionProps;

const defaultChars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function TextScramble({
  children,
  duration = 0.8,
  speed = 0.04,
  characterSet = defaultChars,
  className,
  as: Component = "p",
  trigger = true,
  onScrambleComplete,
  ...props
}: TextScrambleProps): React.JSX.Element {
  const MotionComponent = motion.create(
    Component as keyof JSX.IntrinsicElements,
  );
  const [displayText, setDisplayText] = useState(children);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const text = children;

  useEffect(() => {
    if (!trigger) {
      setDisplayText(text);
      return;
    }

    if (intervalRef.current) clearInterval(intervalRef.current);

    const steps = duration / speed;
    let step = 0;

    intervalRef.current = setInterval(() => {
      let scrambled = "";
      const progress = step / steps;

      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          scrambled += " ";
          continue;
        }
        if (progress * text.length > i) {
          scrambled += text[i];
        } else {
          scrambled +=
            characterSet[Math.floor(Math.random() * characterSet.length)];
        }
      }

      setDisplayText(scrambled);
      step++;

      if (step > steps) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setDisplayText(text);
        onScrambleComplete?.();
      }
    }, speed * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [trigger, text, duration, speed, characterSet, onScrambleComplete]);

  return (
    <MotionComponent className={className} {...props}>
      {displayText}
    </MotionComponent>
  );
}

export default TextScramble;
