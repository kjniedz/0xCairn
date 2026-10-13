-- adds bitcoin payment tracking
ALTER TABLE orders ADD COLUMN pay_txid TEXT;
