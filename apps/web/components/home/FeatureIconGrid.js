function FeatureIcon({ icon }) {
  switch (icon) {
    case 'route':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M5 5h6v6H5zM13 13h6v6h-6z" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M11 8h4a3 3 0 0 1 3 3v2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path
            d="M12 3l7 3v5c0 5-2.8 8.4-7 10-4.2-1.6-7-5-7-10V6l7-3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'receipt':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path
            d="M7 3h10v18l-2-1.4L12 21l-3-1.4L7 21V3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path d="M9 8h6M9 12h6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'runtime':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'db':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <ellipse cx="12" cy="6" rx="7" ry="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 6v8c0 1.7 3.1 3 7 3s7-1.3 7-3V6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'agent':
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="6" y="7" width="12" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="10" cy="12" r="1" fill="currentColor" />
          <circle cx="14" cy="12" r="1" fill="currentColor" />
          <path d="M12 4v3" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    default:
      return null;
  }
}

export default function FeatureIconGrid({ features = [] }) {
  return (
    <div className="hp-feature-grid">
      {features.map((feature) => (
        <article key={feature.title} className="hp-feature-card hp-card">
          <span className="hp-feature-icon">
            <FeatureIcon icon={feature.icon} />
          </span>
          <h3>{feature.title}</h3>
          <p>{feature.description}</p>
        </article>
      ))}
    </div>
  );
}
