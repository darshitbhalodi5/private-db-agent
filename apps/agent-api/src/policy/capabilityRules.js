export const DEFAULT_CAPABILITY_RULES = Object.freeze({
  'balances:read': Object.freeze({
    templates: Object.freeze(['wallet_balances', 'wallet_positions', 'portfolio_summary'])
  }),
  'transactions:read': Object.freeze({
    templates: Object.freeze(['wallet_transactions', 'wallet_activity'])
  }),
  'audit:read': Object.freeze({
    templates: Object.freeze(['access_log_recent', 'policy_denies_recent'])
  }),
  'audit:write': Object.freeze({
    templates: Object.freeze(['access_log_insert'])
  })
});
