import Link from 'next/link';

import AnimatedReveal from '../components/home/AnimatedReveal';
import CtaBlock from '../components/home/CtaBlock';
import FeatureIconGrid from '../components/home/FeatureIconGrid';
import FlowDiagram from '../components/home/FlowDiagram';
import HeroVisual from '../components/home/HeroVisual';
import ProofStrip from '../components/home/ProofStrip';
import SectionHeading from '../components/home/SectionHeading';
import SectionShell from '../components/home/SectionShell';
import TimelineSteps from '../components/home/TimelineSteps';
import { homepageContent } from '../content/homepage-content';

const NAV_ITEMS = [
  { href: '#problem', label: 'Problem' },
  { href: '#workflow', label: 'How It Works' },
  { href: '#proof', label: 'Proof' },
  { href: '#features', label: 'Features' }
];

export default function HomePage() {
  return (
    <main className="hp-root">
      <div className="hp-grid-overlay" aria-hidden />
      <header className="hp-nav-wrap">
        <div className="hp-container hp-nav">
          <Link className="hp-brand" href="/">
            {homepageContent.projectName}
          </Link>
          <nav className="hp-nav-links" aria-label="Homepage sections">
            {NAV_ITEMS.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <Link className="hp-btn hp-btn-secondary" href={homepageContent.ctaPrimary.href}>
            Console
          </Link>
        </div>
      </header>

      <SectionShell id="hero" className="hp-section-hero">
        <div className="hp-hero-grid">
          <AnimatedReveal className="hp-hero-copy hp-load-0" delay={0}>
            <p className="hp-eyebrow">Confidential Data Routing Layer</p>
            <h1>{homepageContent.oneLiner}</h1>
            <p className="hp-hero-subtitle">{homepageContent.solution}</p>
            <div className="hp-hero-actions">
              <Link className="hp-btn hp-btn-primary" href={homepageContent.ctaPrimary.href}>
                {homepageContent.ctaPrimary.label}
              </Link>
              <Link className="hp-btn hp-btn-secondary" href={homepageContent.ctaSecondary.href}>
                {homepageContent.ctaSecondary.label}
              </Link>
            </div>
            <ul className="hp-user-tags" aria-label="Target users">
              {homepageContent.targetUsers.map((user) => (
                <li key={user}>{user}</li>
              ))}
            </ul>
          </AnimatedReveal>

          <AnimatedReveal className="hp-load-1" delay={120}>
            <HeroVisual providers={homepageContent.providers} />
          </AnimatedReveal>
        </div>
      </SectionShell>

      <SectionShell id="problem">
        <div className="hp-split-grid">
          <AnimatedReveal>
            <SectionHeading
              eyebrow="Why this category exists"
              title="Aggregation fails when trust and policy are bolted on late."
              supportingCopy={homepageContent.problem}
            />
          </AnimatedReveal>

          <AnimatedReveal delay={90}>
            <ul className="hp-risk-list hp-card" aria-label="Risk signals">
              {homepageContent.riskSignals.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </AnimatedReveal>
        </div>

        <AnimatedReveal className="hp-collage hp-card" delay={130}>
          <p className="hp-collage-title">Fragmented stack symptoms</p>
          <div className="hp-collage-grid" aria-hidden>
            <div>
              <strong>API A</strong>
              <span>Auth checked</span>
            </div>
            <div>
              <strong>Agent B</strong>
              <span>Policy skipped</span>
            </div>
            <div>
              <strong>DB C</strong>
              <span>Raw SQL ingress</span>
            </div>
            <div>
              <strong>Audit D</strong>
              <span>Receipt missing</span>
            </div>
          </div>
        </AnimatedReveal>
      </SectionShell>

      <SectionShell id="solution">
        <div className="hp-split-grid hp-asymmetric">
          <AnimatedReveal>
            <SectionHeading
              eyebrow="Solution model"
              title="One router contract for auth, policy, and deterministic execution."
              supportingCopy={homepageContent.valueProposition}
            />
          </AnimatedReveal>

          <AnimatedReveal className="hp-boundary-card hp-card" delay={110}>
            <p className="hp-boundary-heading">Boundary diagram</p>
            <div className="hp-boundary-grid">
              <article>
                <h3>Operator layer</h3>
                <p>Signs intent, defines scope, approves AI drafts, reviews receipts.</p>
              </article>
              <article>
                <h3>Router layer</h3>
                <p>Verifies envelopes, enforces grants, and blocks unsafe bypass flags.</p>
              </article>
              <article>
                <h3>Execution layer</h3>
                <p>Runs constrained DB operations and emits audit-friendly metadata.</p>
              </article>
            </div>
          </AnimatedReveal>
        </div>
      </SectionShell>

      <SectionShell id="workflow">
        <AnimatedReveal>
          <SectionHeading
            eyebrow="How it works"
            title="A single flow from request to evidence"
            supportingCopy="Every request follows the same decision graph, so scaling to more data providers does not create policy drift."
            align="center"
          />
        </AnimatedReveal>
        <AnimatedReveal delay={70}>
          <TimelineSteps items={homepageContent.timeline} />
        </AnimatedReveal>
        <AnimatedReveal delay={130}>
          <FlowDiagram />
        </AnimatedReveal>
      </SectionShell>

      <SectionShell id="proof">
        <AnimatedReveal>
          <SectionHeading
            eyebrow="Trust + proof"
            title="Operational signals you can validate"
            supportingCopy="Built-in controls for capability templates, runtime-aware gates, and deny-first policy behavior."
          />
        </AnimatedReveal>
        <AnimatedReveal delay={90}>
          <ProofStrip proofPoints={homepageContent.proofPoints} />
        </AnimatedReveal>
      </SectionShell>

      <SectionShell id="features">
        <AnimatedReveal>
          <SectionHeading
            eyebrow="Feature depth"
            title="Everything needed for an OpenRouter-style private data product"
            supportingCopy="Use this homepage as a repeatable blueprint whenever you launch a new aggregation workflow."
          />
        </AnimatedReveal>
        <AnimatedReveal delay={100}>
          <FeatureIconGrid features={homepageContent.features} />
        </AnimatedReveal>
      </SectionShell>

      <SectionShell id="cta">
        <AnimatedReveal>
          <CtaBlock
            title="Route once, govern everywhere"
            supportingCopy="Start with the control console, configure policy scopes, and ship one trustworthy integration across your private data stack."
            primary={homepageContent.ctaPrimary}
            secondary={homepageContent.ctaSecondary}
          />
        </AnimatedReveal>
      </SectionShell>
    </main>
  );
}
