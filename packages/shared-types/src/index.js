export const OPERATION_TYPES = Object.freeze([
  'read',
  'insert',
  'update',
  'delete',
  'alter',
  'all'
]);

export const SCOPE_TYPES = Object.freeze(['database', 'table']);

export {
  DATABASE_ENGINES,
  FIELD_TYPES,
  IDENTIFIER_PATTERN,
  RESERVED_IDENTIFIERS,
  SCHEMA_DSL_JSON_SCHEMA,
  SCHEMA_DSL_SCHEMA_ID,
  SCHEMA_DSL_VERSION,
  WALLET_ADDRESS_PATTERN
} from './schemaDsl.js';
