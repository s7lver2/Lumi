exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE search_batches
      ADD COLUMN result_json jsonb;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE search_batches DROP COLUMN result_json;`);
};
