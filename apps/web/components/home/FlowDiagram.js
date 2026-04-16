export default function FlowDiagram() {
  return (
    <figure className="hp-flow-diagram hp-card">
      <svg viewBox="0 0 920 320" role="img" aria-label="Signed request to receipt verification flow">
        <defs>
          <marker id="arrow-head" markerWidth="12" markerHeight="12" refX="7" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill="#27463c" />
          </marker>
        </defs>

        <rect x="20" y="95" width="200" height="130" rx="18" fill="#f9f4e9" stroke="#ccbfa9" />
        <text x="44" y="136" fontSize="21" fill="#223127" fontWeight="600">
          Signed Request
        </text>
        <text x="44" y="170" fontSize="16" fill="#3d4d42">
          capability + nonce
        </text>

        <rect x="280" y="45" width="210" height="230" rx="20" fill="#fef8ee" stroke="#baa782" />
        <text x="318" y="106" fontSize="21" fill="#223127" fontWeight="600">
          Policy Gate
        </text>
        <text x="318" y="140" fontSize="16" fill="#3d4d42">
          grants + auth checks
        </text>
        <text x="318" y="176" fontSize="16" fill="#3d4d42">
          runtime attestation
        </text>

        <rect x="550" y="95" width="170" height="130" rx="18" fill="#eef8f1" stroke="#9dbba8" />
        <text x="582" y="136" fontSize="21" fill="#223127" fontWeight="600">
          Execute
        </text>
        <text x="582" y="170" fontSize="16" fill="#3d4d42">
          constrained ops
        </text>

        <rect x="760" y="95" width="140" height="130" rx="18" fill="#eef1fb" stroke="#a5b4d6" />
        <text x="786" y="136" fontSize="21" fill="#223127" fontWeight="600">
          Receipt
        </text>
        <text x="784" y="170" fontSize="16" fill="#3d4d42">
          hash-linked
        </text>

        <line
          x1="220"
          y1="160"
          x2="280"
          y2="160"
          stroke="#27463c"
          strokeWidth="4"
          markerEnd="url(#arrow-head)"
        />
        <line
          x1="490"
          y1="160"
          x2="550"
          y2="160"
          stroke="#27463c"
          strokeWidth="4"
          markerEnd="url(#arrow-head)"
        />
        <line
          x1="720"
          y1="160"
          x2="760"
          y2="160"
          stroke="#27463c"
          strokeWidth="4"
          markerEnd="url(#arrow-head)"
        />
      </svg>
      <figcaption>All routes share one decision pipeline so auth, policy, and receipts remain deterministic.</figcaption>
    </figure>
  );
}
