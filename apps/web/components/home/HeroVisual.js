export default function HeroVisual({ providers = [] }) {
  const midpoint = Math.ceil(providers.length / 2);
  const leftProviders = providers.slice(0, midpoint);
  const rightProviders = providers.slice(midpoint);

  return (
    <aside className="hp-hero-visual hp-card" aria-label="Routing map visualization">
      <div className="hp-signal-row" aria-hidden>
        <span className="hp-signal-dot" />
        <span className="hp-signal-dot" />
        <span className="hp-signal-dot" />
      </div>
      <div className="hp-route-map">
        <ul className="hp-provider-column">
          {leftProviders.map((provider) => (
            <li key={`left-${provider}`} className="hp-provider-chip">
              {provider}
            </li>
          ))}
        </ul>
        <div className="hp-route-core">
          <p>Policy Router</p>
          <span>Signed envelopes + scoped grants</span>
        </div>
        <ul className="hp-provider-column">
          {rightProviders.map((provider) => (
            <li key={`right-${provider}`} className="hp-provider-chip">
              {provider}
            </li>
          ))}
        </ul>
      </div>
      <div className="hp-status-strip" aria-hidden>
        <span>Latency budget</span>
        <strong>58ms</strong>
        <span>Runtime trust</span>
        <strong>Verified</strong>
      </div>
    </aside>
  );
}
