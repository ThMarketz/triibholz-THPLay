/* ============================================================
   server/db.js — the accounts database (node:sqlite, zero deps).

   One file, DATA_DIR/triibholz.db, next to the existing file stores.
   Migrations are an append-only list: each runs once, in its own
   transaction, and is recorded in schema_migrations. A database that
   already has a migration this build does not know was written by a
   newer build — refuse it rather than run old code against it.

   tx(db, fn) is the only way to write more than one row. fn must be
   synchronous: node:sqlite is synchronous, and an `await` inside a
   transaction would let another request's writes interleave with it.
   ============================================================ */
'use strict';
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  {
    id: 1, name: 'identity',
    sql: `
      CREATE TABLE users (
        id                   TEXT PRIMARY KEY,
        display_name         TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
        webauthn_user_handle BLOB NOT NULL UNIQUE CHECK (length(webauthn_user_handle) = 32),
        created_at           INTEGER NOT NULL
      );

      CREATE TABLE credentials (
        id              TEXT PRIMARY KEY,           -- WebAuthn credential id, base64url
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key_jwk  TEXT NOT NULL,
        alg             INTEGER NOT NULL CHECK (alg IN (-7, -8, -257)),
        sign_count      INTEGER NOT NULL DEFAULT 0,
        uv              INTEGER NOT NULL DEFAULT 0,
        backup_eligible INTEGER NOT NULL DEFAULT 0, -- self-reported: display only, never gates access
        backed_up       INTEGER NOT NULL DEFAULT 0,
        transports      TEXT,
        label           TEXT,
        status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'suspect', 'revoked')),
        created_at      INTEGER NOT NULL,
        last_used_at    INTEGER
      );
      CREATE INDEX credentials_user ON credentials(user_id);

      CREATE TABLE sessions (
        token_hash          TEXT PRIMARY KEY,       -- sha256 of the cookie value; the token is never stored
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id       TEXT REFERENCES credentials(id) ON DELETE CASCADE,
        uv                  INTEGER NOT NULL DEFAULT 0,
        stepup_at           INTEGER,
        created_at          INTEGER NOT NULL,
        last_seen_at        INTEGER NOT NULL,
        expires_at          INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        label               TEXT
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE clubs (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE club_members (
        club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role         TEXT NOT NULL CHECK (role IN ('admin', 'coach', 'trainer', 'player')),
        status       TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'removed')),
        requested_at INTEGER NOT NULL,
        decided_at   INTEGER,
        decided_by   TEXT,
        PRIMARY KEY (club_id, user_id)
      );
      CREATE INDEX club_members_user ON club_members(user_id);

      -- Challenges are bound to their flow: the endpoint fixes the kind, and the user, club and
      -- link code come from this row, never from the request body.
      CREATE TABLE challenges (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('register', 'login', 'pair', 'recover', 'stepup', 'join')),
        challenge      TEXT NOT NULL,
        user_id        TEXT REFERENCES users(id) ON DELETE CASCADE,
        club_id        TEXT REFERENCES clubs(id) ON DELETE CASCADE,
        link_code_hash TEXT,
        payload        TEXT,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL,
        used_at        INTEGER
      );
      CREATE INDEX challenges_expiry ON challenges(expires_at);

      -- Single-use codes. Only the hash is stored; a wrong code matches no row, so there is no
      -- attempts counter to maintain.
      CREATE TABLE link_codes (
        code_hash  TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('club-admin', 'staff-invite', 'pair', 'recover', 'player-link')),
        user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,   -- whose account (pair, recover)
        club_id    TEXT REFERENCES clubs(id) ON DELETE CASCADE,
        role       TEXT CHECK (role IS NULL OR role IN ('admin', 'coach', 'trainer', 'player')),
        created_by TEXT NOT NULL,                                 -- a user id, or 'operator'
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at    INTEGER,
        used_by    TEXT,
        revoked_at INTEGER
      );
      CREATE INDEX link_codes_expiry ON link_codes(expires_at);

      -- Ids, never names or codes.
      CREATE TABLE audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      INTEGER NOT NULL,
        actor   TEXT NOT NULL,
        action  TEXT NOT NULL,
        subject TEXT,
        club_id TEXT,
        detail  TEXT
      );
      CREATE INDEX audit_club ON audit(club_id, at);
      CREATE INDEX audit_subject ON audit(subject, at);

      -- A club always keeps at least one approved admin once it has one: no demotion, removal,
      -- or deletion (directly, or by deleting the user) may take the last one away. In the
      -- database, so no code path can forget it.
      CREATE TRIGGER club_keeps_an_admin_on_update
      BEFORE UPDATE OF role, status, club_id ON club_members
      WHEN OLD.role = 'admin' AND OLD.status = 'approved'
       AND (NEW.role <> 'admin' OR NEW.status <> 'approved' OR NEW.club_id <> OLD.club_id)
       AND (SELECT count(*) FROM club_members WHERE club_id = OLD.club_id AND role = 'admin' AND status = 'approved') = 1
      BEGIN SELECT RAISE(ABORT, 'last-admin'); END;

      CREATE TRIGGER club_keeps_an_admin_on_delete
      BEFORE DELETE ON club_members
      WHEN OLD.role = 'admin' AND OLD.status = 'approved'
       AND (SELECT count(*) FROM club_members WHERE club_id = OLD.club_id AND role = 'admin' AND status = 'approved') = 1
      BEGIN SELECT RAISE(ABORT, 'last-admin'); END;
    `,
  },
  {
    id: 2, name: 'rate-limits',
    sql: `
      -- Fixed-window counters, in the database so a restart does not reset them.
      CREATE TABLE rate_limits (
        key          TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count        INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3, name: 'server-keys',
    sql: `
      -- Random secrets the server makes for itself on first start (e.g. to sign stateless
      -- sign-in challenges). Never shown, never leave the database.
      CREATE TABLE server_keys (
        name       TEXT PRIMARY KEY,
        secret     BLOB NOT NULL CHECK (length(secret) >= 32),
        created_at INTEGER NOT NULL
      );
    `,
  },
];

function tx(db, fn) {
  const nested = db.isTransaction;
  const sp = nested ? 'tx_' + (tx._n = (tx._n || 0) + 1) : null;
  db.exec(nested ? `SAVEPOINT ${sp}` : 'BEGIN IMMEDIATE');
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      out.then(() => {}, () => {});   // it already started; don't also crash on its rejection
      throw Object.assign(new Error('tx: the function must be synchronous (read and validate first, then write)'), { code: 'tx-async' });
    }
    db.exec(nested ? `RELEASE ${sp}` : 'COMMIT');
    return out;
  } catch (e) {
    if (nested) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
    else if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

function migrate(db, migrations = MIGRATIONS, now = Date.now()) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const known = new Set(migrations.map(m => m.id));
  const ids = migrations.map(m => m.id);
  if (ids.some((id, i) => i && id <= ids[i - 1])) throw new Error('migrations must be listed in increasing id order');
  // refuse a database from a newer build before touching it
  const unknown = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r => r.id).filter(id => !known.has(id));
  if (unknown.length) throw Object.assign(new Error(`database has migration(s) ${unknown.join(', ')} that this build does not know — it was written by a newer version`), { code: 'db-newer' });
  const applied = [];
  for (const m of migrations) {
    tx(db, () => {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(m.id)) return;
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, now);
      applied.push(m.id);
    });
  }
  return applied;
}

function open(file, { migrations = MIGRATIONS, now } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  try { migrate(db, migrations, now); } catch (e) { db.close(); throw e; }
  return db;
}

module.exports = { open, tx, migrate, MIGRATIONS };
