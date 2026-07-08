// db/migrations/1720400100000_add_points_failed.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE areas
    ADD COLUMN points_failed integer NOT NULL DEFAULT 0;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE areas DROP COLUMN points_failed;`);
};