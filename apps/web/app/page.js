'use client';

import { useEffect, useMemo, useState } from 'react';

const DB_ENGINES = ['postgres', 'sqlite'];
const FIELD_TYPES = ['text', 'integer', 'numeric', 'boolean', 'timestamp', 'jsonb'];
const OPERATIONS = ['all', 'read', 'insert', 'update', 'delete', 'alter'];

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function createPermissionInputs() {
  return OPERATIONS.reduce((accumulator, operation) => {
    accumulator[operation] = '';
    return accumulator;
  }, {});
}

function createField() {
  return {
    id: makeId('field'),
    name: '',
    type: 'text',
    nullable: true,
    primaryKey: false
  };
}

function createTable(index) {
  return {
    id: makeId('table'),
    name: `table_${index}`,
    fields: [createField()],
    permissionInputs: createPermissionInputs()
  };
}

function isWalletAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizeWalletAddress(value) {
  return value.toLowerCase();
}

function parseWalletInput(rawValue) {
  const tokens = String(rawValue || '')
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const validSet = new Set();
  const invalid = [];

  for (const token of tokens) {
    if (isWalletAddress(token)) {
      validSet.add(normalizeWalletAddress(token));
      continue;
    }

    invalid.push(token);
  }

  return {
    valid: [...validSet],
    invalid
  };
}

function buildPayloadDraft({
  requestId,
  creator,
  databaseName,
  databaseEngine,
  description,
  universalWallets,
  databasePermissionInputs,
  tables,
  aiPrompt
}) {
  const issues = [];

  const creatorWallet = creator.address.trim();
  if (!creatorWallet) {
    issues.push('Connect creator wallet before submitting.');
  } else if (!isWalletAddress(creatorWallet)) {
    issues.push('Connected wallet address format is invalid.');
  }

  const dbName = databaseName.trim();
  if (!dbName) {
    issues.push('Database name is required.');
  }

  const normalizedUniversalWallets = [];
  universalWallets.forEach((row, index) => {
    const address = row.address.trim();
    const label = row.label.trim();

    if (!address && !label) {
      return;
    }

    if (!address) {
      issues.push(`Universal wallet row ${index + 1} is missing address.`);
      return;
    }

    if (!isWalletAddress(address)) {
      issues.push(`Universal wallet row ${index + 1} has invalid address: ${address}`);
      return;
    }

    normalizedUniversalWallets.push({
      walletAddress: normalizeWalletAddress(address),
      label: label || null
    });
  });

  const grants = [];
  const databasePermissions = {};

  OPERATIONS.forEach((operation) => {
    const parsed = parseWalletInput(databasePermissionInputs[operation]);
    if (parsed.invalid.length > 0) {
      issues.push(
        `Database ${operation} permission has invalid wallet(s): ${parsed.invalid.join(', ')}`
      );
    }

    databasePermissions[operation] = parsed.valid;
    parsed.valid.forEach((walletAddress) => {
      grants.push({
        walletAddress,
        scopeType: 'database',
        scopeId: '*',
        operation,
        effect: 'allow'
      });
    });
  });

  if (!Array.isArray(tables) || tables.length === 0) {
    issues.push('At least one table is required.');
  }

  const normalizedTables = (tables || []).map((table, tableIndex) => {
    const tableName = table.name.trim();
    if (!tableName) {
      issues.push(`Table ${tableIndex + 1} is missing table name.`);
    }

    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      issues.push(`Table ${tableIndex + 1} must contain at least one field.`);
    }

    const fields = (table.fields || []).map((field, fieldIndex) => {
      const fieldName = field.name.trim();
      if (!fieldName) {
        issues.push(`Table ${tableIndex + 1} field ${fieldIndex + 1} is missing field name.`);
      }

      return {
        name: fieldName,
        type: FIELD_TYPES.includes(field.type) ? field.type : 'text',
        nullable: field.primaryKey ? false : Boolean(field.nullable),
        primaryKey: Boolean(field.primaryKey)
      };
    });

    const permissions = {};
    OPERATIONS.forEach((operation) => {
      const parsed = parseWalletInput(table.permissionInputs[operation]);
      if (parsed.invalid.length > 0) {
        issues.push(
          `Table ${tableName || tableIndex + 1} ${operation} permission has invalid wallet(s): ${parsed.invalid.join(', ')}`
        );
      }

      permissions[operation] = parsed.valid;
      parsed.valid.forEach((walletAddress) => {
        grants.push({
          walletAddress,
          scopeType: 'table',
          scopeId: tableName || `table_${tableIndex + 1}`,
          operation,
          effect: 'allow'
        });
      });
    });

    return {
      tableId: table.id,
      name: tableName,
      fields,
      permissions
    };
  });

  const deduplicatedGrants = [];
  const grantKeys = new Set();

  for (const grant of grants) {
    const key = [
      grant.walletAddress,
      grant.scopeType,
      grant.scopeId,
      grant.operation,
      grant.effect
    ].join('|');

    if (grantKeys.has(key)) {
      continue;
    }

    grantKeys.add(key);
    deduplicatedGrants.push(grant);
  }

  return {
    issues,
    payload: {
      requestId,
      requestedAt: new Date().toISOString(),
      creator: {
        walletAddress: creatorWallet ? normalizeWalletAddress(creatorWallet) : null,
        chainId: Number.isInteger(creator.chainId) ? creator.chainId : null
      },
      database: {
        name: dbName,
        engine: databaseEngine,
        description: description.trim() || null,
        universalWallets: normalizedUniversalWallets,
        permissions: databasePermissions
      },
      tables: normalizedTables,
      grants: deduplicatedGrants,
      aiAssist: aiPrompt.trim() ? { prompt: aiPrompt.trim() } : null,
      metadata: {
        source: 'web-control-plane',
        version: '0.1.0'
      }
    }
  };
}

function formatAddress(address) {
  if (!address) {
    return 'Not connected';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseChainId(rawValue) {
  if (!rawValue) {
    return null;
  }

  if (typeof rawValue === 'number') {
    return Number.isInteger(rawValue) ? rawValue : null;
  }

  if (typeof rawValue === 'string' && rawValue.startsWith('0x')) {
    const parsed = Number.parseInt(rawValue, 16);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export default function HomePage() {
  const [requestId, setRequestId] = useState(() => makeId('req'));
  const [creator, setCreator] = useState({
    address: '',
    chainId: null
  });
  const [walletError, setWalletError] = useState('');

  const [databaseName, setDatabaseName] = useState('');
  const [databaseEngine, setDatabaseEngine] = useState('postgres');
  const [description, setDescription] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');

  const [universalWallets, setUniversalWallets] = useState([
    { id: makeId('wallet'), address: '', label: '' }
  ]);

  const [databasePermissionInputs, setDatabasePermissionInputs] = useState(
    createPermissionInputs()
  );

  const [tables, setTables] = useState([createTable(1)]);
  const [submission, setSubmission] = useState(null);
  const [submissionError, setSubmissionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum || !window.ethereum.on) {
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      const nextAddress = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : '';
      setCreator((previous) => ({
        ...previous,
        address: nextAddress
      }));
    };

    const handleChainChanged = (chainId) => {
      setCreator((previous) => ({
        ...previous,
        chainId: parseChainId(chainId)
      }));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      if (!window.ethereum.removeListener) {
        return;
      }

      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const draft = useMemo(
    () =>
      buildPayloadDraft({
        requestId,
        creator,
        databaseName,
        databaseEngine,
        description,
        universalWallets,
        databasePermissionInputs,
        tables,
        aiPrompt
      }),
    [
      requestId,
      creator,
      databaseName,
      databaseEngine,
      description,
      universalWallets,
      databasePermissionInputs,
      tables,
      aiPrompt
    ]
  );

  const canSubmit = draft.issues.length === 0;

  async function connectWallet() {
    if (typeof window === 'undefined' || !window.ethereum || !window.ethereum.request) {
      setWalletError('No browser wallet found. Install MetaMask or another EIP-1193 wallet.');
      return;
    }

    setWalletError('');

    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const chainIdRaw = await window.ethereum.request({ method: 'eth_chainId' });

      const address = Array.isArray(accounts) && accounts.length > 0 ? accounts[0] : '';
      setCreator({
        address,
        chainId: parseChainId(chainIdRaw)
      });
    } catch (error) {
      setWalletError(error?.message || 'Wallet connection failed.');
    }
  }

  function disconnectWallet() {
    setCreator({
      address: '',
      chainId: null
    });
    setWalletError('');
  }

  function updateUniversalWallet(id, key, value) {
    setUniversalWallets((previous) =>
      previous.map((wallet) => (wallet.id === id ? { ...wallet, [key]: value } : wallet))
    );
  }

  function addUniversalWalletRow() {
    setUniversalWallets((previous) => [...previous, { id: makeId('wallet'), address: '', label: '' }]);
  }

  function removeUniversalWalletRow(id) {
    setUniversalWallets((previous) => {
      if (previous.length === 1) {
        return [{ id: makeId('wallet'), address: '', label: '' }];
      }

      return previous.filter((wallet) => wallet.id !== id);
    });
  }

  function updateDatabasePermission(operation, value) {
    setDatabasePermissionInputs((previous) => ({
      ...previous,
      [operation]: value
    }));
  }

  function addTable() {
    setTables((previous) => [...previous, createTable(previous.length + 1)]);
  }

  function removeTable(tableId) {
    setTables((previous) => {
      if (previous.length === 1) {
        return [createTable(1)];
      }

      return previous.filter((table) => table.id !== tableId);
    });
  }

  function updateTable(tableId, key, value) {
    setTables((previous) =>
      previous.map((table) => (table.id === tableId ? { ...table, [key]: value } : table))
    );
  }

  function updateTablePermission(tableId, operation, value) {
    setTables((previous) =>
      previous.map((table) =>
        table.id === tableId
          ? {
              ...table,
              permissionInputs: {
                ...table.permissionInputs,
                [operation]: value
              }
            }
          : table
      )
    );
  }

  function addField(tableId) {
    setTables((previous) =>
      previous.map((table) =>
        table.id === tableId
          ? {
              ...table,
              fields: [...table.fields, createField()]
            }
          : table
      )
    );
  }

  function removeField(tableId, fieldId) {
    setTables((previous) =>
      previous.map((table) => {
        if (table.id !== tableId) {
          return table;
        }

        if (table.fields.length === 1) {
          return {
            ...table,
            fields: [createField()]
          };
        }

        return {
          ...table,
          fields: table.fields.filter((field) => field.id !== fieldId)
        };
      })
    );
  }

  function updateField(tableId, fieldId, key, value) {
    setTables((previous) =>
      previous.map((table) => {
        if (table.id !== tableId) {
          return table;
        }

        return {
          ...table,
          fields: table.fields.map((field) => {
            if (field.id !== fieldId) {
              return field;
            }

            const nextField = {
              ...field,
              [key]: value
            };

            if (key === 'primaryKey' && value) {
              nextField.nullable = false;
            }

            return nextField;
          })
        };
      })
    );
  }

  async function submitDraft(event) {
    event.preventDefault();

    if (!canSubmit || isSubmitting) {
      return;
    }

    setSubmission(null);
    setSubmissionError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/control-plane/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(draft.payload)
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.message || body?.error || 'Submission failed.');
      }

      setSubmission(body);
      setRequestId(makeId('req'));
    } catch (error) {
      setSubmissionError(error?.message || 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">Task 1 · Frontend Foundation</p>
        <h1>Dynamic Policy DB Control Plane</h1>
        <p>
          Create table schema, attach wallet-level permissions by operation, preview the payload,
          then submit to the agent intake endpoint.
        </p>
      </section>

      <form className="layout-grid" onSubmit={submitDraft}>
        <section className="card">
          <header>
            <h2>1. Creator Wallet</h2>
          </header>
          <div className="stack-sm">
            <div className="inline-row">
              <button type="button" className="btn" onClick={connectWallet}>
                Connect Wallet
              </button>
              <button type="button" className="btn btn-muted" onClick={disconnectWallet}>
                Reset
              </button>
            </div>
            <div className="meta-grid">
              <p>
                <span>Address</span>
                <strong>{formatAddress(creator.address)}</strong>
              </p>
              <p>
                <span>Chain ID</span>
                <strong>{creator.chainId ?? 'Unknown'}</strong>
              </p>
              <p>
                <span>Request ID</span>
                <strong>{requestId}</strong>
              </p>
            </div>
            {walletError ? <p className="error-text">{walletError}</p> : null}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>2. Database Configuration</h2>
          </header>
          <div className="field-grid two-col">
            <label>
              Database name
              <input
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
                placeholder="branch_operations"
              />
            </label>
            <label>
              Engine
              <select
                value={databaseEngine}
                onChange={(event) => setDatabaseEngine(event.target.value)}
              >
                {DB_ENGINES.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short description for this policy space"
              rows={3}
            />
          </label>
          <label>
            AI Help Prompt (draft only)
            <textarea
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="Example: create inventory and audit tables with read/insert for branch managers"
              rows={3}
            />
          </label>
        </section>

        <section className="card">
          <header className="section-row">
            <h2>3. Universal DB Wallet List</h2>
            <button type="button" className="btn btn-muted" onClick={addUniversalWalletRow}>
              Add Wallet
            </button>
          </header>
          <div className="stack-sm">
            {universalWallets.map((wallet, index) => (
              <div className="wallet-row" key={wallet.id}>
                <label>
                  Wallet {index + 1}
                  <input
                    value={wallet.address}
                    onChange={(event) =>
                      updateUniversalWallet(wallet.id, 'address', event.target.value)
                    }
                    placeholder="0x..."
                  />
                </label>
                <label>
                  Label
                  <input
                    value={wallet.label}
                    onChange={(event) => updateUniversalWallet(wallet.id, 'label', event.target.value)}
                    placeholder="finance-admin"
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeUniversalWalletRow(wallet.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <header>
            <h2>4. Database Permission Matrix</h2>
            <p className="muted">Add one or multiple addresses per operation (comma or whitespace separated).</p>
          </header>
          <div className="stack-sm">
            {OPERATIONS.map((operation) => (
              <label key={`db-${operation}`}>
                {operation}
                <input
                  value={databasePermissionInputs[operation]}
                  onChange={(event) => updateDatabasePermission(operation, event.target.value)}
                  placeholder="0xabc..., 0xdef..."
                />
              </label>
            ))}
          </div>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>5. Tables, Fields, and Table-Level Permissions</h2>
            <button type="button" className="btn" onClick={addTable}>
              Add Table
            </button>
          </header>

          <div className="stack-md">
            {tables.map((table, tableIndex) => (
              <article className="table-card" key={table.id}>
                <header className="section-row">
                  <h3>Table {tableIndex + 1}</h3>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => removeTable(table.id)}
                  >
                    Remove Table
                  </button>
                </header>

                <label>
                  Table name
                  <input
                    value={table.name}
                    onChange={(event) => updateTable(table.id, 'name', event.target.value)}
                    placeholder="ledger_entries"
                  />
                </label>

                <div className="section-row section-row-tight">
                  <h4>Fields</h4>
                  <button type="button" className="btn btn-muted" onClick={() => addField(table.id)}>
                    Add Field
                  </button>
                </div>

                <div className="stack-sm">
                  {table.fields.map((field, fieldIndex) => (
                    <div className="field-row" key={field.id}>
                      <label>
                        Name
                        <input
                          value={field.name}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'name', event.target.value)
                          }
                          placeholder={`field_${fieldIndex + 1}`}
                        />
                      </label>
                      <label>
                        Type
                        <select
                          value={field.type}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'type', event.target.value)
                          }
                        >
                          {FIELD_TYPES.map((fieldType) => (
                            <option key={fieldType} value={fieldType}>
                              {fieldType}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={field.nullable}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'nullable', event.target.checked)
                          }
                          disabled={field.primaryKey}
                        />
                        Nullable
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={field.primaryKey}
                          onChange={(event) =>
                            updateField(table.id, field.id, 'primaryKey', event.target.checked)
                          }
                        />
                        Primary key
                      </label>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => removeField(table.id, field.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <h4>Table Permission Matrix</h4>
                <div className="stack-sm">
                  {OPERATIONS.map((operation) => (
                    <label key={`${table.id}-${operation}`}>
                      {operation}
                      <input
                        value={table.permissionInputs[operation]}
                        onChange={(event) =>
                          updateTablePermission(table.id, operation, event.target.value)
                        }
                        placeholder="0xabc..., 0xdef..."
                      />
                    </label>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card full-width">
          <header className="section-row">
            <h2>6. Request Preview and Submit</h2>
            <button
              type="submit"
              className="btn"
              disabled={!canSubmit || isSubmitting}
              title={canSubmit ? 'Submit payload' : 'Resolve validation errors first'}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Payload'}
            </button>
          </header>

          {draft.issues.length > 0 ? (
            <div className="issues-box">
              <h3>Validation Issues</h3>
              <ul>
                {draft.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="ok-text">Payload is valid and ready for submission.</p>
          )}

          {submissionError ? <p className="error-text">{submissionError}</p> : null}

          {submission ? (
            <div className="result-box">
              <h3>Submission Result</h3>
              <pre>{JSON.stringify(submission, null, 2)}</pre>
            </div>
          ) : null}

          <pre className="json-preview">{JSON.stringify(draft.payload, null, 2)}</pre>
        </section>
      </form>
    </main>
  );
}
