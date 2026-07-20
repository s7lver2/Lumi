// db/migrations/1721300000000_background_jobs.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE background_jobs (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind         text NOT NULL,
      label        text NOT NULL,
      status       text NOT NULL DEFAULT 'running',
      error        text,
      result       jsonb,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE background_jobs;`);
};