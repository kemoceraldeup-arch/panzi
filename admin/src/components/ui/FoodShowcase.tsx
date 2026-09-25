import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Leaf } from 'lucide-react';

const dishes = [
  { photo: 'adobo', name: 'Chicken Adobo' },
  { photo: 'sinigang', name: 'Sinigang na Baboy' },
  { photo: 'tinola', name: 'Tinolang Manok' },
  { photo: 'ginisang_munggo', name: 'Ginisang Munggo' },
  { photo: 'pancit_canton', name: 'Pancit Canton' },
  { photo: 'menudo', name: 'Menudo' },
  { photo: 'kaldereta', name: 'Kaldereta' },
  { photo: 'tortang_talong', name: 'Tortang Talong' },
];

export function FoodShowcase() {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % dishes.length), 4500);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, index]);

  return (
    <figure
      className="login-photo"
      aria-label="Panzi food showcase"
      aria-roledescription="carousel"
    >
      {dishes.map((dish, position) => (
        <motion.img
          key={dish.photo}
          src={`/recipes/${dish.photo}.jpg`}
          alt={dish.name}
          aria-hidden={position !== index}
          initial={false}
          animate={{ opacity: position === index ? 1 : 0, scale: position === index && !reducedMotion ? 1.05 : 1 }}
          transition={{ opacity: { duration: reducedMotion ? 0 : 0.8 }, scale: { duration: reducedMotion ? 0 : 5, ease: 'linear' } }}
        />
      ))}
      <figcaption aria-live="off">
        <span className="login-photo-icon"><Leaf size={19} aria-hidden="true" /></span>
        <span>{dishes[index].name}<small>From pantry to plate.</small></span>
        <span className="login-photo-count">{index + 1} / {dishes.length}</span>
      </figcaption>
    </figure>
  );
}
