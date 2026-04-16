export default function ProofStrip({ proofPoints = [] }) {
  return (
    <div className="hp-proof-grid">
      {proofPoints.map((point) => (
        <article key={point.label} className="hp-proof-card hp-card">
          <p className="hp-proof-label">{point.label}</p>
          <p className="hp-proof-value">{point.value}</p>
        </article>
      ))}
    </div>
  );
}
