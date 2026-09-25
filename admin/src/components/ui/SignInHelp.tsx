import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

export function SignInHelp() {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <div className="login-help">
      <button
        type="button"
        className="login-help-toggle"
        aria-expanded={open}
        aria-controls="login-help-content"
        onClick={() => setOpen((value) => !value)}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }} aria-hidden="true">
          <ChevronRight size={16} />
        </motion.span>
        Need help signing in?
      </button>
      <motion.div
        id="login-help-content"
        className="login-help-content"
        aria-hidden={!open}
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="login-help-body">
          <p>Ask an existing administrator for access. If you have forgotten your password,
            contact the project owner to restore your account.</p>
        </div>
      </motion.div>
    </div>
  );
}
