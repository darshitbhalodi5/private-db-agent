import Link from 'next/link';

export default function CtaBlock({ title, supportingCopy, primary, secondary }) {
  return (
    <div className="hp-cta-block hp-card">
      <div className="hp-cta-copy">
        <h2>{title}</h2>
        <p>{supportingCopy}</p>
      </div>
      <div className="hp-cta-actions">
        <Link className="hp-btn hp-btn-primary hp-btn-pulse" href={primary.href}>
          {primary.label}
        </Link>
        <Link className="hp-btn hp-btn-secondary" href={secondary.href}>
          {secondary.label}
        </Link>
      </div>
    </div>
  );
}
