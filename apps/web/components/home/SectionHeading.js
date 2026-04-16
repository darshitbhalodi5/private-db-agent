export default function SectionHeading({ eyebrow, title, supportingCopy, align = 'left' }) {
  const classes = ['hp-heading', align === 'center' ? 'hp-heading-center' : ''].join(' ').trim();

  return (
    <header className={classes}>
      {eyebrow ? <p className="hp-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {supportingCopy ? <p className="hp-subtitle">{supportingCopy}</p> : null}
    </header>
  );
}
