// db/migrations/1721500000000_search_batches_phase.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE search_batches ADD COLUMN current_phase text;`);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE search_batches DROP COLUMN current_phase;`);
};  