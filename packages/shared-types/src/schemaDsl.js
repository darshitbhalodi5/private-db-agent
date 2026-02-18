export const SCHEMA_DSL_VERSION = '2026-02-18';
export const SCHEMA_DSL_SCHEMA_ID = 'eigen-private-db-agent.schema-dsl.v1';
export const IDENTIFIER_PATTERN = '^[a-z][a-z0-9_]{0,62}$';
export const WALLET_ADDRESS_PATTERN = '^0x[a-fA-F0-9]{40}$';

export const DATABASE_ENGINES = Object.freeze(['postgres', 'sqlite']);
export const FIELD_TYPES = Object.freeze([
  'text',
  'integer',
  'numeric',
  'boolean',
  'timestamp',
  'jsonb'
]);

export const RESERVED_IDENTIFIERS = Object.freeze([
  'select',
  'insert',
  'update',
  'delete',
  'create',
  'drop',
  'alter',
  'table',
  'from',
  'where',
  'join',
  'union',
  'grant',
  'revoke',
  'truncate'
]);

export const SCHEMA_DSL_JSON_SCHEMA = Object.freeze({
  $id: SCHEMA_DSL_SCHEMA_ID,
  type: 'object',
  additionalProperties: true,
  required: ['requestId', 'creator', 'database', 'tables'],
  properties: {
    requestId: { type: 'string', minLength: 1 },
    creator: {
      type: 'object',
      additionalProperties: true,
      required: ['walletAddress'],
      properties: {
        walletAddress: {
          type: 'string',
          pattern: WALLET_ADDRESS_PATTERN
        },
        chainId: {
          type: ['integer', 'null'],
          minimum: 1
        }
      }
    },
    database: {
      type: 'object',
      additionalProperties: true,
      required: ['name', 'engine'],
      properties: {
        name: {
          type: 'string',
          pattern: IDENTIFIER_PATTERN
        },
        engine: {
          type: 'string',
          enum: DATABASE_ENGINES
        },
        description: {
          type: ['string', 'null']
        }
      }
    },
    tables: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['name', 'fields'],
        properties: {
          name: {
            type: 'string',
            pattern: IDENTIFIER_PATTERN
          },
          fields: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['name', 'type'],
              properties: {
                name: {
                  type: 'string',
                  pattern: IDENTIFIER_PATTERN
                },
                type: {
                  type: 'string',
                  enum: FIELD_TYPES
                },
                nullable: {
                  type: 'boolean'
                },
                primaryKey: {
                  type: 'boolean'
                }
              }
            }
          }
        }
      }
    },
    grants: {
      type: 'array'
    }
  }
});
