// db/migrations/1721600000000_model_usage.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE model_usage (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      kind TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      total_duration_ms BIGINT NOT NULL DEFAULT 0,
      UNIQUE (date, kind)
    );
  `);
  pgm.sql(`
    CREATE TABLE model_usage_rates (
      kind TEXT PRIMARY KEY,
      rate_usd_per_hour NUMERIC NOT NULL DEFAULT 0
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE model_usage_rates;`);
  pgm.sql(`DROP TABLE model_usage;`);
};
