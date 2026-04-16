export const homepageContent = {
  projectName: 'Eigen Data Router',
  oneLiner: 'Aggregate private data agents behind one policy-aware endpoint.',
  problem:
    'Teams ship AI features across many databases and services, but each new integration adds auth drift, policy drift, and audit blind spots.',
  solution:
    'Eigen Data Router normalizes routing, enforcement, and receipts so every query follows the same trust model before execution.',
  valueProposition:
    'Ship one integration, route to many private data runtimes, and keep cryptographic proof for every decision.',
  targetUsers: ['AI product teams', 'Protocol operators', 'Security and compliance leads'],
  features: [
    {
      icon: 'route',
      title: 'Unified request routing',
      description: 'Route capability-scoped requests to the right DB adapter, policy grant, and execution path.'
    },
    {
      icon: 'shield',
      title: 'Policy-first execution',
      description: 'Default-deny authorization enforces tenant, table, and operation scope before every action.'
    },
    {
      icon: 'receipt',
      title: 'Signed action receipts',
      description: 'Every response includes hash-linked metadata so audit pipelines can verify decisions later.'
    },
    {
      icon: 'runtime',
      title: 'Runtime attestation gate',
      description: 'Sensitive mutations can be blocked unless runtime verification status is healthy and trusted.'
    },
    {
      icon: 'db',
      title: 'Multi-engine data layer',
      description: 'Use SQLite locally, switch to Postgres in runtime, and keep one control-plane contract.'
    },
    {
      icon: 'agent',
      title: 'Agent-to-agent ready',
      description: 'Issue scoped tasks and signed auth envelopes for cooperating services without bypass flags.'
    }
  ],
  proofPoints: [
    { label: 'Capability templates', value: '5' },
    { label: 'Core data operations', value: '4' },
    { label: 'Runtime-aware mutation gates', value: 'Enabled' },
    { label: 'Default policy mode', value: 'Deny-first' }
  ],
  ctaPrimary: {
    label: 'Open Control Console',
    href: '/console'
  },
  ctaSecondary: {
    label: 'View Runtime Status',
    href: '/api/runtime/attestation'
  },
  themeVariant: 'sand-grid',
  motionVariant: 'stagger-rise',
  visualDirection: 'editorial-tech',
  sectionVisuals: ['kinetic-hero-map', 'risk-evidence-collage', 'flow-diagram', 'timeline', 'proof-strip'],
  providers: ['Postgres', 'SQLite', 'Policy Engine', 'A2A Tasks', 'Eigen AI', 'Audit Ledger'],
  riskSignals: [
    'Inconsistent policy checks across services',
    'Unsigned internal override paths',
    'No single receipt chain for operator actions',
    'Runtime trust assumptions scattered across teams'
  ],
  timeline: [
    {
      step: '1',
      title: 'Define and sign request',
      description: 'Actor signs a stable envelope with capability, template, nonce, and timestamp.'
    },
    {
      step: '2',
      title: 'Policy + runtime gate',
      description: 'Router verifies auth, evaluates grants, and checks runtime attestation for sensitive actions.'
    },
    {
      step: '3',
      title: 'Deterministic execution',
      description: 'Validated operations run through constrained adapters without raw SQL ingress.'
    },
    {
      step: '4',
      title: 'Receipt and audit export',
      description: 'Hash-linked receipt metadata is returned for compliance, replay defense, and forensics.'
    }
  ]
};
