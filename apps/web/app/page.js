export default function HomePage() {
  return (
    <main className="shell">
      <section className="panel">
        <h1>Eigen Private DB Agent</h1>
        <p>
          Monorepo frontend scaffold is ready. Next tasks will implement wallet connect,
          dynamic schema builder, permission matrix, and AI-assisted policy drafting.
        </p>
        <ul>
          <li>Backend API: <code>apps/agent-api</code></li>
          <li>Shared packages: <code>packages/*</code></li>
          <li>This app: <code>apps/web</code></li>
        </ul>
      </section>
    </main>
  );
}
