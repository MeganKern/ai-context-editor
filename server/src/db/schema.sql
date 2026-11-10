-- The Desk's database, created on an empty database when the server starts (db/pool.ts).
-- Rules:
--   * text lives in blobs: content-addressed, never changed or deleted, so any code may add one
--   * a card's text is a revision, and revisions are only ever added: what a card said, and who or
--     what wrote it, is never overwritten. The card points at its current revision.
--   * a run records what it was sent (its prompt, and a manifest of every part with the exact
--     revision or text hash it used) when it starts, in the same transaction
--   * lists are ordered by order keys (shared/order-key.ts): putting something in writes one row
--   * every thread-scoped table has thread_id (copying a thread and routing events are generic)
--   * every write goes through the writer (db/writer.ts), which opens a change set; the history
--     trigger records each row change against it
--   * what's only about your view (folded, seen, drafts) and caches (checkpoints, the workspace
--     file index) are kept out of the history

CREATE SEQUENCE desk_seq;

CREATE TABLE blobs (
  hash        text PRIMARY KEY,
  content     bytea   NOT NULL,
  bytes       integer NOT NULL,
  tokens      integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Full-text index of card texts (what the sidebar search reads).
CREATE TABLE blob_search (
  hash  text PRIMARY KEY REFERENCES blobs(hash),
  tsv   tsvector NOT NULL
);
CREATE INDEX blob_search_tsv ON blob_search USING GIN (tsv);

CREATE TABLE workspaces (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  path              text NOT NULL UNIQUE,
  agent_permission  text NOT NULL DEFAULT 'locked',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE folders (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  parent_id     text REFERENCES folders(id) ON DELETE SET NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notes (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  folder_id     text REFERENCES folders(id) ON DELETE SET NULL,
  name          text NOT NULL,
  content_hash  text NOT NULL REFERENCES blobs(hash),
  -- A thread's own copy of another item (it keeps the name, so the model's heading doesn't change).
  copied_from   text REFERENCES notes(id),
  -- This note is a newer version of the one it supersedes. Forms a chain, not a tree.
  supersedes    text REFERENCES notes(id) ON DELETE SET NULL,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threads (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id),
  kind              text NOT NULL CHECK (kind IN ('chat', 'template')),
  name              text NOT NULL,
  folder_id         text REFERENCES folders(id) ON DELETE SET NULL,
  -- The model alias picked for this thread; null means the default.
  model             text,
  origin_thread_id  text REFERENCES threads(id),
  origin_how        text CHECK (origin_how IN ('duplicate', 'branch', 'template_run', 'made_template')),
  -- A branch: the card in the origin thread it was taken at (everything up to it was copied).
  origin_message_id text,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((origin_thread_id IS NULL) = (origin_how IS NULL)),
  CHECK (origin_message_id IS NULL OR origin_how = 'branch'),
  -- A branch lives with the conversation it came from, and a template's run with its template:
  -- neither has a folder of its own.
  CHECK (folder_id IS NULL OR origin_how IS NULL OR origin_how IN ('duplicate', 'made_template'))
);

CREATE TABLE runs (
  id                     text PRIMARY KEY,
  workspace_id           text NOT NULL REFERENCES workspaces(id),
  thread_id              text REFERENCES threads(id),
  kind                   text NOT NULL CHECK (kind IN ('reply', 'agent', 'template', 'summarize', 'title', 'combine')),
  status                 text NOT NULL DEFAULT 'queued'
                           CHECK (status IN ('queued', 'running', 'done', 'failed', 'stopped', 'timed_out', 'interrupted')),
  -- A step of a template run.
  parent_run_id          text REFERENCES runs(id),
  -- An agent follow-up: the run whose session it continues (in a fork of that session).
  follows_run_id         text REFERENCES runs(id),
  -- reply / agent: the card it writes. summarize: the summary. template: the thread it writes.
  node_id                text,
  summary_id             text,
  output_thread_id       text REFERENCES threads(id),
  input                  jsonb NOT NULL DEFAULT '{}',
  -- The model asked, by its full id (null for a template run, which asks none itself).
  model_id               text,
  -- Recorded when it starts: exactly what it is sent, and every part of it by id and text hash.
  prompt_hash            text REFERENCES blobs(hash),
  manifest               jsonb,
  -- The server that started it.
  boot_id                text,
  -- What came back: the result text, and for an agent Claude Code's own output, line by line.
  result_hash            text REFERENCES blobs(hash),
  transcript_hash        text REFERENCES blobs(hash),
  -- An agent: its own CLI session (each run gets its own, forked from the one it follows), and
  -- the Claude Code version that ran it.
  session_id             text,
  tool_version           text,
  progress               jsonb,
  error                  text,
  -- 'length': the model stopped at the output limit, so the text is cut off.
  finish                 text CHECK (finish IN ('complete', 'length')),
  estimated_input_tokens integer,
  input_tokens           integer,
  output_tokens          integer,
  cancel_requested_at    timestamptz,
  process_gid            integer,
  process_start_time     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  ended_at               timestamptz,
  CHECK ((status IN ('queued', 'running')) = (ended_at IS NULL)),
  CHECK ((kind = 'template') = (output_thread_id IS NOT NULL)),
  CHECK ((kind = 'summarize') = (summary_id IS NOT NULL)),
  CHECK ((kind IN ('reply', 'agent')) = (node_id IS NOT NULL)),
  CHECK (session_id IS NULL OR kind = 'agent'),
  CHECK (follows_run_id IS NULL OR kind = 'agent'),
  CHECK (progress IS NULL OR kind = 'template'),
  CHECK (finish IS NULL OR status = 'done'),
  CHECK (status = 'queued' OR kind = 'template' OR status <> 'running' OR prompt_hash IS NOT NULL),
  CHECK (parent_run_id IS NULL OR parent_run_id <> id),
  CHECK (follows_run_id IS NULL OR follows_run_id <> id)
);
CREATE UNIQUE INDEX one_live_run_per_node ON runs (node_id) WHERE status IN ('queued', 'running');
CREATE INDEX runs_workspace ON runs (workspace_id, created_at DESC);
CREATE INDEX runs_thread ON runs (thread_id, created_at DESC) WHERE thread_id IS NOT NULL;
CREATE INDEX runs_node ON runs (node_id, created_at DESC) WHERE node_id IS NOT NULL;
CREATE INDEX runs_parent ON runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX runs_follows ON runs (follows_run_id) WHERE follows_run_id IS NOT NULL;
CREATE INDEX runs_live ON runs (workspace_id) WHERE status IN ('queued', 'running');

-- You've seen how a run ended (on its card, or by dismissing its notice). View state: no history.
CREATE TABLE run_seen (
  run_id   text PRIMARY KEY REFERENCES runs(id),
  seen_at  timestamptz NOT NULL DEFAULT now()
);

-- What a live run has written so far, saved every second so a restart keeps it. A cache.
CREATE TABLE run_checkpoints (
  run_id      text PRIMARY KEY REFERENCES runs(id),
  text_so_far text NOT NULL DEFAULT '',
  raw         jsonb NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cards. Their text is a revision; whether one is being written is a live run on it.
CREATE TABLE messages (
  id                   text PRIMARY KEY,
  thread_id            text NOT NULL REFERENCES threads(id),
  order_key            text COLLATE "C" NOT NULL,
  role                 text NOT NULL CHECK (role IN ('user', 'assistant', 'agent')),
  author_kind          text NOT NULL CHECK (author_kind IN ('you', 'model', 'agent', 'template')),
  current_revision_id  text,
  excluded             boolean NOT NULL DEFAULT false,
  deleted              boolean NOT NULL DEFAULT false,
  -- Set on a copy (a branch or a duplicate): the card it was copied from, in the other thread.
  copied_from          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, id),
  CONSTRAINT messages_order UNIQUE (thread_id, order_key),
  CHECK (   (role = 'user'      AND author_kind IN ('you', 'template'))
         OR (role = 'assistant' AND author_kind = 'model')
         OR (role = 'agent'     AND author_kind = 'agent')),
  -- Your messages always have text.
  CHECK (role <> 'user' OR current_revision_id IS NOT NULL)
);

-- Same-thread integrity: a reference to a message can only point inside its own thread.
ALTER TABLE runs ADD CONSTRAINT runs_node_same_thread
  FOREIGN KEY (thread_id, node_id) REFERENCES messages (thread_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE revisions (
  id           text PRIMARY KEY,
  thread_id    text NOT NULL REFERENCES threads(id),
  card_id      text NOT NULL,
  text_hash    text NOT NULL REFERENCES blobs(hash),
  -- you: you wrote or edited it. run: a run wrote it (run_id). copy: copied with the card into a
  -- branch or a duplicate (copied_from; run_id is the run that wrote the original).
  made_by      text NOT NULL CHECK (made_by IN ('you', 'run', 'copy')),
  run_id       text REFERENCES runs(id),
  copied_from  text REFERENCES revisions(id),
  -- False for what a run had written when it stopped, failed or was cut off.
  complete     boolean NOT NULL,
  -- Why an unfinished text ends where it does, decided when it's made: how its run ended, or
  -- 'copied' for a copy taken while the card was being written (a copy keeps its original's).
  cut_off      text CHECK (cut_off IN ('stopped', 'interrupted', 'failed', 'timed_out', 'copied')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (card_id, id),
  FOREIGN KEY (thread_id, card_id) REFERENCES messages (thread_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (made_by <> 'you'  OR (run_id IS NULL AND complete)),
  CHECK (made_by <> 'run'  OR run_id IS NOT NULL),
  CHECK (made_by <> 'copy' OR copied_from IS NOT NULL OR run_id IS NOT NULL),
  CHECK (complete = (cut_off IS NULL))
);
CREATE INDEX revisions_card ON revisions (card_id, created_at);
CREATE INDEX revisions_run ON revisions (run_id) WHERE run_id IS NOT NULL;

-- A card's current text is one of its own revisions.
ALTER TABLE messages ADD CONSTRAINT messages_current_revision
  FOREIGN KEY (id, current_revision_id) REFERENCES revisions (card_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are only ever added', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER revisions_only_added BEFORE UPDATE OR DELETE ON revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Folded cards: how you see the thread, not what the model gets. View state: no history.
CREATE TABLE card_view (
  card_id  text PRIMARY KEY REFERENCES messages(id),
  folded   boolean NOT NULL DEFAULT false
);

-- What you'd typed in a thread's message box and not sent. View state: no history.
CREATE TABLE drafts (
  thread_id   text PRIMARY KEY REFERENCES threads(id),
  message     text NOT NULL DEFAULT '',
  task        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Where a library item goes in a thread: one place per item — with every reply (in order) or
-- with one message (right after it, when that message is sent).
CREATE TABLE thread_items (
  id          text PRIMARY KEY,
  thread_id   text NOT NULL REFERENCES threads(id),
  note_id     text NOT NULL REFERENCES notes(id),
  placement   text NOT NULL CHECK (placement IN ('every_reply', 'with_message')),
  message_id  text,
  order_key   text COLLATE "C",
  excluded    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, note_id),
  CHECK ((placement = 'with_message') = (message_id IS NOT NULL)),
  CHECK ((placement = 'every_reply') = (order_key IS NOT NULL)),
  FOREIGN KEY (thread_id, message_id) REFERENCES messages (thread_id, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX thread_items_order ON thread_items (thread_id, order_key) WHERE order_key IS NOT NULL;

-- Pins: this thread only, at the top of every reply.
CREATE TABLE directives (
  id                 text PRIMARY KEY,
  thread_id          text NOT NULL REFERENCES threads(id),
  text_hash          text NOT NULL REFERENCES blobs(hash),
  order_key          text COLLATE "C" NOT NULL,
  excluded           boolean NOT NULL DEFAULT false,
  source_message_id  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, order_key),
  FOREIGN KEY (thread_id, source_message_id) REFERENCES messages (thread_id, id) DEFERRABLE INITIALLY DEFERRED
);

-- A summary stands in for exactly the cards it covers (summary_cards): messages, or other
-- summaries in use when it was written. The exact texts it was written from are in the manifest
-- of the run that wrote it (written_by_run).
CREATE TABLE summaries (
  id              text PRIMARY KEY,
  thread_id       text NOT NULL REFERENCES threads(id),
  status          text NOT NULL DEFAULT 'drafting'
                    CHECK (status IN ('drafting', 'review', 'active', 'inactive', 'discarded')),
  content_hash    text REFERENCES blobs(hash),
  written_by_run  text REFERENCES runs(id),
  -- A copy taken while it was being written: it has what had been written then (perhaps nothing).
  cut_off         boolean NOT NULL DEFAULT false,
  -- Your note for the next draft of a summary under review.
  feedback        text,
  instructions_hash text REFERENCES blobs(hash),
  copied_from     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('drafting', 'review', 'discarded') OR content_hash IS NOT NULL)
);
ALTER TABLE runs ADD CONSTRAINT runs_summary_fk FOREIGN KEY (summary_id) REFERENCES summaries(id);

CREATE TABLE summary_cards (
  id               text PRIMARY KEY,
  thread_id        text NOT NULL REFERENCES threads(id),
  summary_id       text NOT NULL REFERENCES summaries(id),
  position         integer NOT NULL,
  message_id       text,
  card_summary_id  text REFERENCES summaries(id),
  UNIQUE (summary_id, position),
  CHECK ((message_id IS NULL) <> (card_summary_id IS NULL)),
  CHECK (card_summary_id IS NULL OR card_summary_id <> summary_id),
  FOREIGN KEY (thread_id, message_id) REFERENCES messages (thread_id, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX summary_cards_summary ON summary_cards (summary_id, position);

CREATE TABLE template_steps (
  id          text PRIMARY KEY,
  thread_id   text NOT NULL REFERENCES threads(id),
  position    integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('post', 'reply', 'agent')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── What agents changed ──────────────────────────────────────────────────────
-- The workspace folder as last scanned (path, size, time, content hash), so a scan only reads
-- files that changed. A cache: no history.
CREATE TABLE workspace_files (
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  path          text NOT NULL,
  size          bigint NOT NULL,
  mtime_ms      double precision NOT NULL,
  hash          text NOT NULL,
  PRIMARY KEY (workspace_id, path)
);

-- Each file an agent's run changed in the workspace folder (from scans before and after it), and
-- each path outside the folder its tools named. Texts are blobs when they were small enough to
-- keep. Only ever added.
CREATE TABLE agent_file_changes (
  id           text PRIMARY KEY,
  run_id       text NOT NULL REFERENCES runs(id),
  path         text NOT NULL,
  change       text NOT NULL CHECK (change IN ('added', 'modified', 'deleted', 'outside')),
  before_hash  text,
  after_hash   text,
  before_size  bigint,
  after_size   bigint
);
CREATE INDEX agent_file_changes_run ON agent_file_changes (run_id);
CREATE TRIGGER agent_file_changes_only_added BEFORE UPDATE OR DELETE ON agent_file_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ── History ──────────────────────────────────────────────────────────────────
-- change_sets: what was asked (one row per action, with its input). row_history: every row it
-- changed, before and after. Both share one sequence, so the order of everything is known.
CREATE TABLE change_sets (
  id            text PRIMARY KEY,
  seq           bigint NOT NULL UNIQUE DEFAULT nextval('desk_seq'),
  workspace_id  text,
  thread_ids    text[] NOT NULL DEFAULT '{}',
  actor_kind    text NOT NULL CHECK (actor_kind IN ('you', 'run', 'system')),
  actor_id      text,
  action        text NOT NULL,
  input         jsonb NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_sets_ws_seq ON change_sets (workspace_id, seq);

CREATE TABLE row_history (
  seq         bigint NOT NULL DEFAULT nextval('desk_seq'),
  change_set  text REFERENCES change_sets(id),
  tbl         text NOT NULL,
  row_id      text NOT NULL,
  op          text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
  old_row     jsonb,
  new_row     jsonb
);
CREATE INDEX row_history_cs ON row_history (change_set);
CREATE INDEX row_history_row ON row_history (tbl, row_id, seq);

CREATE FUNCTION record_row_change() RETURNS trigger AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN o := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN n := to_jsonb(NEW); END IF;
  INSERT INTO row_history (change_set, tbl, row_id, op, old_row, new_row)
  VALUES (NULLIF(current_setting('desk.change_set', true), ''), TG_TABLE_NAME,
          COALESCE(n, o)->>'id', TG_OP, o, n);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workspaces','folders','notes','threads','runs','messages','revisions',
                           'thread_items','directives','summaries','summary_cards','template_steps']
  LOOP
    EXECUTE format('CREATE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION record_row_change()', t);
  END LOOP;
END $$;

-- Which open threads a change set touched, so their pages are read again. (Every change set also
-- refreshes its workspace: the thread list carries each thread's marks.) Actions on view state,
-- which has no history, name the threads they touched themselves (Ctx.touch).
-- R1: rows carrying thread_id
-- R2: threads rows themselves
-- R3: threads that use a changed library item (what they send changed)
-- R4: the output thread of a changed template run (it shows the run's progress)
-- R5: every output thread of a template whose run list, name or deletion changed ("run 2 of 5")
-- R6: the thread a changed thread was taken from (its branch points changed)
-- R7: the branches of a changed thread (where they came from is shown in them)
CREATE FUNCTION finalize_change_set(cs text) RETURNS void AS $$
  UPDATE change_sets c SET
    thread_ids = COALESCE((
      WITH rh AS (
        SELECT tbl, op, row_id, old_row, new_row FROM row_history WHERE change_set = cs
      ),
      touched_notes AS (SELECT row_id AS note_id FROM rh WHERE tbl = 'notes'),
      template_threads AS (
        SELECT new_row->>'thread_id' AS id FROM rh
         WHERE tbl = 'runs' AND op = 'INSERT' AND new_row->>'kind' = 'template'
        UNION
        SELECT row_id FROM rh
         WHERE tbl = 'threads' AND COALESCE(new_row->>'kind', old_row->>'kind') = 'template'
           AND (old_row->>'name'       IS DISTINCT FROM new_row->>'name'
             OR old_row->>'deleted_at' IS DISTINCT FROM new_row->>'deleted_at')
      )
      SELECT array_agg(DISTINCT tid) FROM (
        SELECT COALESCE(new_row->>'thread_id', old_row->>'thread_id') AS tid FROM rh
        UNION SELECT row_id FROM rh WHERE tbl = 'threads'
        UNION SELECT thread_id FROM thread_items WHERE note_id IN (SELECT note_id FROM touched_notes)
        UNION SELECT COALESCE(new_row->>'output_thread_id', old_row->>'output_thread_id') FROM rh
               WHERE tbl = 'runs' AND COALESCE(new_row->>'kind', old_row->>'kind') = 'template'
        UNION SELECT id FROM threads
               WHERE origin_how = 'template_run' AND origin_thread_id IN (SELECT id FROM template_threads)
        UNION SELECT COALESCE(new_row->>'origin_thread_id', old_row->>'origin_thread_id') FROM rh WHERE tbl = 'threads'
        UNION SELECT id FROM threads
               WHERE origin_how = 'branch' AND origin_thread_id IN (SELECT row_id FROM rh WHERE tbl = 'threads')
      ) x WHERE tid IS NOT NULL), '{}'),
    workspace_id = COALESCE(c.workspace_id, (
      SELECT t.workspace_id FROM row_history rh
        JOIN threads t ON t.id = COALESCE(rh.new_row->>'thread_id', rh.old_row->>'thread_id', CASE WHEN rh.tbl = 'threads' THEN rh.row_id END)
       WHERE rh.change_set = cs LIMIT 1), (
      SELECT COALESCE(new_row->>'workspace_id', old_row->>'workspace_id')
        FROM row_history WHERE change_set = cs
         AND COALESCE(new_row->>'workspace_id', old_row->>'workspace_id') IS NOT NULL LIMIT 1), (
      SELECT row_id FROM row_history WHERE change_set = cs AND tbl = 'workspaces' LIMIT 1))
  WHERE c.id = cs;
$$ LANGUAGE sql;

-- Global system message — instructions that shape every model reply, across all workspaces and threads.
-- One row (id = 'global'). Changes go through the writer (change_sets + row_history). The text is
-- content-addressed in blobs, and every run records the text_hash it used in its manifest.
CREATE TABLE system_message (
  id         text PRIMARY KEY DEFAULT 'global',
  text_hash  text REFERENCES blobs(hash),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON system_message
  FOR EACH ROW EXECUTE FUNCTION record_row_change();

-- Agent preamble — per-workspace standing instructions prepended to every agent's brief.
-- One row per workspace (id = workspace_id). Content-addressed in blobs, tracked in row_history.
CREATE TABLE agent_preamble (
  id         text PRIMARY KEY REFERENCES workspaces(id),
  text_hash  text REFERENCES blobs(hash),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER history AFTER INSERT OR UPDATE OR DELETE ON agent_preamble
  FOR EACH ROW EXECUTE FUNCTION record_row_change();

-- App-level settings (key-value). Not workspace-scoped — things like which LLM backend to use.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
