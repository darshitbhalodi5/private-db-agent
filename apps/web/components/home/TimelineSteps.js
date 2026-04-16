export default function TimelineSteps({ items = [] }) {
  return (
    <ol className="hp-timeline" aria-label="How Eigen Data Router works">
      {items.map((item) => (
        <li key={item.step} className="hp-timeline-step hp-card">
          <span className="hp-step-number">{item.step}</span>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </li>
      ))}
    </ol>
  );
}
