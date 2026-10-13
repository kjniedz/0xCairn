-- 0xCairn API schema (Cloudflare D1). Apply with:
--   XDG_CONFIG_HOME=~/.config/wrangler-personal npx wrangler d1 execute 0xcairn --remote --file=worker/schema.sql
-- Stores only what is needed to fulfil orders. Never any private key material.

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,                 -- 'split' (Pro address), 'create2' (Teams), 'sharecard'
  status TEXT NOT NULL,               -- awaiting_payment | queued | mining | found | expired | cancelled | refunded
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  started_at INTEGER,
  found_at INTEGER,
  expires_at INTEGER,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  mask_hex TEXT,
  value_hex TEXT,
  public_key TEXT,                    -- requester's uncompressed public key (split)
  deployer TEXT,                      -- create2
  init_code_hash TEXT,                -- create2
  difficulty REAL NOT NULL,
  expected_seconds REAL NOT NULL,
  quote_usd REAL NOT NULL,
  pay_asset TEXT,                     -- 'USDC' | 'ETH'
  pay_chain TEXT,                     -- 'base' | 'ethereum'
  pay_amount TEXT,                    -- decimal string in asset units
  pay_address TEXT,
  pay_index INTEGER,
  eth_usd REAL,
  email TEXT,
  api_key_id INTEGER,
  attempts REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  lease_at INTEGER,
  worker_id TEXT,
  result_hex TEXT,                    -- offset (split) or salt (create2)
  result_address TEXT,
  refund_requested_at INTEGER,
  refund_address TEXT,
  pay_txid TEXT                       -- bitcoin: txid consumed by this order
);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  postpaid INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  message TEXT NOT NULL
);
