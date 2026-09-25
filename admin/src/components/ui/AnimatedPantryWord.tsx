import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

const words = ['pantry.', 'kitchen.', 'table.'];

/** The supplied 21st.dev hero's spring word transition, adapted to our heading. */
export function AnimatedPantryWord() {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % words.length);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  return (
    <em className="login-animated-word" aria-label="pantry.">
      {/* Reserve the widest word so the heading and photo never shift. */}
      {words.map((word) => (
        <span key={word} className="login-word-size" aria-hidden="true">{word}</span>
      ))}
      <AnimatePresence initial={false}>
        <motion.span
          className="login-word-slide"
          key={reducedMotion ? 0 : index}
          aria-hidden="true"
          initial={{ opacity: 0, y: '110%' }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: '-110%' }}
          transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 50, damping: 16 }}
        >
          {words[reducedMotion ? 0 : index]}
        </motion.span>
      </AnimatePresence>
    </em>
  );
}
