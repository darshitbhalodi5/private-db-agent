'use client';

import { useEffect, useRef, useState } from 'react';

export default function AnimatedReveal({ as: Tag = 'div', className = '', delay = 0, children }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const syncPreference = () => {
      const reduce = mediaQuery.matches;
      setPrefersReducedMotion(reduce);
      if (reduce) {
        setIsVisible(true);
      }
    };

    syncPreference();
    mediaQuery.addEventListener?.('change', syncPreference);

    if (mediaQuery.matches || !ref.current) {
      return () => {
        mediaQuery.removeEventListener?.('change', syncPreference);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.22,
        rootMargin: '0px 0px -8% 0px'
      }
    );

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener?.('change', syncPreference);
    };
  }, []);

  const classes = ['hp-reveal', isVisible ? 'is-visible' : '', className].join(' ').trim();

  const style = prefersReducedMotion
    ? undefined
    : {
        transitionDelay: `${delay}ms`
      };

  return (
    <Tag ref={ref} className={classes} style={style}>
      {children}
    </Tag>
  );
}
