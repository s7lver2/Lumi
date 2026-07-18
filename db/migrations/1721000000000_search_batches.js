exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE search_batches (
      id         uuid PRIMARY KEY,
      total      integer NOT NULL,
      done       integer NOT NULL DEFAULT 0,
      failed     integer NOT NULL DEFAULT 0,
      status     text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE search_batches;`);
};