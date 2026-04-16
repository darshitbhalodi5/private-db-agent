export default function SectionShell({ id, className = '', children }) {
  const classes = ['hp-section', className].join(' ').trim();

  return (
    <section id={id} className={classes}>
      <div className="hp-container">{children}</div>
    </section>
  );
}
