// db/migrations/1720700000000_worker_heartbeat.js
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE worker_heartbeat (
      id         integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO worker_heartbeat (id) VALUES (1);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE worker_heartbeat;`);
};
