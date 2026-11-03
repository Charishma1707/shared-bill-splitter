CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT check_homes_name CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT check_members_name CHECK (length(trim(name)) > 0),
  CONSTRAINT uq_members_home_order UNIQUE (home_id, order_index)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE,
  CONSTRAINT check_bills_title CHECK (length(trim(title)) > 0),
  CONSTRAINT check_bills_total_cents CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT,
  CONSTRAINT check_shares_amount_cents CHECK (amount_cents >= 0),
  CONSTRAINT uq_shares_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX idx_members_home_id ON members(home_id);
CREATE INDEX idx_bills_home_id ON bills(home_id);
CREATE INDEX idx_shares_bill_id ON shares(bill_id);
CREATE INDEX idx_shares_member_id ON shares(member_id);
