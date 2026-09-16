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
  {
    id: 4, name: 'club-membership',
    sql: `
      -- Multi-use join codes: a club's link for a team's parents group. Player role only.
      CREATE TABLE club_join_codes (
        code_hash   TEXT PRIMARY KEY,
        club_id     TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        label       TEXT CHECK (label IS NULL OR length(label) <= 60),
        max_pending INTEGER NOT NULL DEFAULT 60 CHECK (max_pending BETWEEN 1 AND 200),
        uses        INTEGER NOT NULL DEFAULT 0,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        revoked_at  INTEGER
      );
      CREATE INDEX club_join_codes_club ON club_join_codes(club_id);

      -- an admin's own note on an invite ("Anna – U14 coach"); shown only to the club's admins
      ALTER TABLE link_codes ADD COLUMN label TEXT CHECK (label IS NULL OR length(label) <= 60);

      -- member_ref: the id a club sees for a person (never the global user id, so two clubs cannot
      -- match their lists). request_no: 4 digits the admin compares in person before approving.
      ALTER TABLE club_members ADD COLUMN member_ref TEXT;
      ALTER TABLE club_members ADD COLUMN request_no TEXT;
      ALTER TABLE club_members ADD COLUMN via TEXT;
      ALTER TABLE club_members ADD COLUMN prev_status TEXT;
      ALTER TABLE club_members ADD COLUMN prev_decided_at INTEGER;
      ALTER TABLE club_members ADD COLUMN prev_decided_by TEXT;

      ALTER TABLE users ADD COLUMN ever_approved INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN last_request_at INTEGER;
      UPDATE users SET ever_approved = 1 WHERE id IN (SELECT user_id FROM club_members WHERE status = 'approved');
    `,
    // rows from before this migration get their member_ref here; new rows must bring one
    run(db) {
      const { randomBytes } = require('node:crypto');
      const set = db.prepare('UPDATE club_members SET member_ref = ? WHERE club_id = ? AND user_id = ?');
      for (const r of db.prepare('SELECT club_id, user_id FROM club_members WHERE member_ref IS NULL').all()) {
        set.run('m_' + randomBytes(16).toString('base64url'), r.club_id, r.user_id);
      }
      db.exec(`
        CREATE UNIQUE INDEX club_members_ref ON club_members(member_ref);
        CREATE UNIQUE INDEX club_members_pending_no ON club_members(club_id, request_no) WHERE status = 'pending' AND request_no IS NOT NULL;
        CREATE INDEX club_members_via ON club_members(club_id, via) WHERE status = 'pending';
        CREATE TRIGGER club_members_need_ref BEFORE INSERT ON club_members WHEN NEW.member_ref IS NULL
        BEGIN SELECT RAISE(ABORT, 'member-ref-required'); END;
      `);
    },
  },
  {
    id: 5, name: 'assets-and-feeds',
    sql: `
      -- Who a stored file belongs to: match videos, the clips cut from them, analysis jobs and
      -- generated clips. A file with no row here is from before accounts existed: nobody may read
      -- it over HTTP (the operator can still reach the volume).
      CREATE TABLE assets (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL CHECK (kind IN ('video', 'clip', 'job', 'videogen')),
        club_id       TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        meta          TEXT
      );
      CREATE INDEX assets_club ON assets(club_id, kind);
      CREATE INDEX assets_owner ON assets(owner_user_id);

      -- A calendar feed is a capability URL: a calendar app fetches it with no cookie, so the token
      -- IS the permission. The server issues it (one a client invented is refused), only a club's
      -- staff may, and any of them can be revoked.
      CREATE TABLE calendar_feeds (
        token_hash TEXT PRIMARY KEY,
        club_id    TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        label      TEXT,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX calendar_feeds_club ON calendar_feeds(club_id);
    `,
  },
  {
    id: 6, name: 'teams-and-rosters',
    sql: `
      -- How a session began. Uploading a device's rosters is the one irreversible write of real
      -- minors' data, so it is allowed only from a session the person opened themselves. A session
      -- minted by following a pairing, join or recovery link was opened by clicking something
      -- somebody else sent. Rows from before this migration become 'legacy' and may not upload
      -- until the next sign-in. Slices 6 and 7 must pass 'pair' and 'recover' from their own
      -- createSession calls, or the rule quietly reopens.
      ALTER TABLE sessions ADD COLUMN origin TEXT CHECK (origin IS NULL OR origin IN
        ('login', 'club-admin', 'staff-invite', 'join', 'pair', 'recover', 'legacy'));

      -- A club's teams. sync_key = HMAC(server_keys['team-sync'], club_id:uploader:local_id), so a
      -- retried upload by the same coach is a no-op, another coach's upload of a colliding local id
      -- creates its own team and can neither see nor overwrite theirs, and the device's own id —
      -- Math.random, and carried between devices in .thplay.json exports — is never stored.
      -- season is the year the season STARTS (1 Sep, js/eligibility.js seasonOf): without it "same
      -- category" means "same category ever", and last season's team conflicts with this one's.
      -- category is CHECKed for shape only: SQLite cannot ALTER a CHECK and the federation
      -- restructures leagues, so the list of ids lives in the JS module both sides read.
      CREATE TABLE club_teams (
        id           TEXT PRIMARY KEY,                     -- 'ct_' + 22 base64url (ID.newId)
        club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        sync_key     TEXT NOT NULL,
        name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        category     TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 16),
        season       INTEGER NOT NULL CHECK (season BETWEEN 2000 AND 2100),
        league_label TEXT NOT NULL DEFAULT '' CHECK (length(league_label) <= 60),
        created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        rev          INTEGER NOT NULL DEFAULT 1,           -- what a conditional UPDATE conditions on
        archived_at  INTEGER
      );
      CREATE UNIQUE INDEX club_teams_sync ON club_teams(club_id, sync_key);
      CREATE INDEX club_teams_club ON club_teams(club_id, season, category);
      -- so a staff or member row can name (team_id, club_id) as one reference
      CREATE UNIQUE INDEX club_teams_id_club ON club_teams(id, club_id);

      -- The club's players. PER CLUB, so adding a licence never says whether another club has that
      -- player, and one club's name correction never reaches another club's sheet.
      -- The id is 128 random bits and is NOT derived from the licence: on the device a player's id
      -- IS 'L' + licence (js/teams.js), and using that as a server id would put a minor's licence
      -- number into every manifest key and audit detail that carried it — and a licence is the
      -- same string in every club, which is exactly what member_ref exists to prevent.
      -- There is deliberately NO json/meta column and NO status column: wpmatch's Eligibility text
      -- ("Ausländer-Étranger", "Inactive License") is a nationality statement about a named child
      -- that any holder of the public licence can re-derive in one request, so storing it buys
      -- nothing and would put it in every backup. The device keeps it in its own offline copy.
      CREATE TABLE club_players (
        id           TEXT PRIMARY KEY,                     -- 'cp_' + 22 base64url
        club_id      TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        licence      TEXT,                                 -- the wpmatch slug; NULL while it is pending
        sync_key     TEXT,                                 -- licence-pending players only; carries nothing personal
        name         TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 80),
        first_name   TEXT NOT NULL DEFAULT '' CHECK (length(first_name) <= 80),
        name_edited  INTEGER NOT NULL DEFAULT 0 CHECK (name_edited IN (0, 1)),
        name_guessed INTEGER NOT NULL DEFAULT 0 CHECK (name_guessed IN (0, 1)),
        -- A YEAR, and only for a player with no licence yet, because nothing else can supply it.
        -- wpmatch's \`date\` is a full date of birth and is never fetched (js/wpmatch.js); this is
        -- that rule written where no code path can forget it. An INTEGER column alone is NOT the
        -- guard: SQLite stores '2013-04-17' in it as text. typeof() is what refuses it.
        birth_year   INTEGER CHECK (typeof(birth_year) IN ('null', 'integer')
                                    AND (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100)),
        gender       TEXT NOT NULL DEFAULT '' CHECK (gender IN ('', 'M', 'F')),
        added_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        rev          INTEGER NOT NULL DEFAULT 1,
        left_at      INTEGER,                              -- no live roster row since then
        CHECK (licence IS NULL OR (length(licence) BETWEEN 3 AND 6 AND licence NOT GLOB '*[^0-9]*')),
        CHECK (licence IS NOT NULL OR sync_key IS NOT NULL),
        -- a licensed player's year and gender come from wpmatch on the coach's own device, never here
        CHECK (licence IS NULL OR (birth_year IS NULL AND gender = ''))
      );
      CREATE UNIQUE INDEX club_players_licence ON club_players(club_id, licence) WHERE licence IS NOT NULL;
      CREATE UNIQUE INDEX club_players_sync ON club_players(club_id, sync_key) WHERE sync_key IS NOT NULL;
      CREATE INDEX club_players_club ON club_players(club_id, name);
      CREATE INDEX club_players_left ON club_players(left_at) WHERE left_at IS NOT NULL;

      -- The roster. cap and gk belong to a TEAM, not to a person: the same player is cap 1 in the
      -- U16 and cap 7 in the NLB, and a shared column would silently move her on the other team's
      -- printed sheet. A player who leaves keeps the row with removed_at set — the retention clock,
      -- "was she on this list in March", and the conflict check all need it, and a hard delete would
      -- make deleting a team the way to make a conflict warning go away before a match.
      CREATE TABLE club_team_players (
        team_id        TEXT NOT NULL REFERENCES club_teams(id) ON DELETE CASCADE,
        club_player_id TEXT NOT NULL REFERENCES club_players(id) ON DELETE CASCADE,
        cap            TEXT NOT NULL DEFAULT '' CHECK (length(cap) <= 2 AND cap NOT GLOB '*[^0-9]*'),
        gk             INTEGER NOT NULL DEFAULT 0 CHECK (gk IN (0, 1)),
        added_at       INTEGER NOT NULL,
        added_by       TEXT,
        removed_at     INTEGER,
        removed_by     TEXT,
        PRIMARY KEY (team_id, club_player_id)
      );
      CREATE INDEX club_team_players_live ON club_team_players(club_player_id) WHERE removed_at IS NULL;

      -- Who may work on a team. The two references together mean a row cannot name a team of one
      -- club and a membership of another. They are INTEGRITY, not authorization: a club_members row
      -- also exists while pending, denied and removed, so every query joins club_members and
      -- re-checks status = 'approved' and the role. Removal and demotion do not DELETE that row
      -- (identity.js sets status/role), so the cascade below never fires on its own —
      -- identity.js loseTeamRoles() is what removes these, inside the caller's transaction.
      CREATE TABLE club_team_staff (
        team_id  TEXT NOT NULL,
        club_id  TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        added_by TEXT,
        PRIMARY KEY (team_id, user_id),
        FOREIGN KEY (team_id, club_id) REFERENCES club_teams(id, club_id) ON DELETE CASCADE,
        FOREIGN KEY (club_id, user_id) REFERENCES club_members(club_id, user_id) ON DELETE CASCADE
      );
      CREATE INDEX club_team_staff_user ON club_team_staff(club_id, user_id);

      -- The club's MEMBERS on a team: accounts, so a coach knows who they may write to. Deliberately
      -- a different table from club_team_players — one is an account, the other is a child who has
      -- none — and nothing here says the two are the same person. That claim needs a one-time code
      -- handed over in person (slice 7): a name match is a guess, and two members of one club with
      -- the same folded name are common enough that clubs.js already warns about it.
      CREATE TABLE club_team_members (
        team_id  TEXT NOT NULL,
        club_id  TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        added_by TEXT,
        PRIMARY KEY (team_id, user_id),
        FOREIGN KEY (team_id, club_id) REFERENCES club_teams(id, club_id) ON DELETE CASCADE,
        FOREIGN KEY (club_id, user_id) REFERENCES club_members(club_id, user_id) ON DELETE CASCADE
      );
      CREATE INDEX club_team_members_user ON club_team_members(club_id, user_id);
    `,
    // Existing sessions cannot know how they began. They are 'legacy' and may not upload.
    run(db) {
      db.prepare("UPDATE sessions SET origin = 'legacy' WHERE origin IS NULL").run();
    },
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
      if (m.sql) db.exec(m.sql);
      if (m.run) m.run(db);
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
