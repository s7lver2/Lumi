exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE background_jobs
      ADD COLUMN progress_phase text,
      ADD COLUMN progress_current integer,
      ADD COLUMN progress_total integer;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE background_jobs
      DROP COLUMN progress_phase,
      DROP COLUMN progress_current,
      DROP COLUMN progress_total;
  `);
};
