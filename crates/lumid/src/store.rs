//! SQLite del plano de control. Una sola conexión bajo mutex: el volumen es
//! de decenas de operaciones por minuto, no de miles por segundo.
//! ponytail: si el plano de control llega a ser el cuello de botella, se pasa
//! a un pool; hoy sería complejidad sin causa.

use anyhow::Result;
use lumi_proto::api::DaemonState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS pair_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    secret_phc TEXT NOT NULL,
    expires_at INTEGER,
    consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_phc TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    running INTEGER NOT NULL,
    exit_code INTEGER,
    started_at INTEGER NOT NULL
);
";

pub struct Store(Mutex<Connection>);

impl Store {
    pub fn open(dir: &Path) -> Result<Self> {
        let c = Connection::open(dir.join("lumi.db"))?;
        c.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(c)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().expect("mutex del store envenenado")
    }

    pub fn state(&self) -> DaemonState {
        let c = self.conn();
        let has_admin: i64 = c
            .query_row("SELECT COUNT(*) FROM users WHERE is_admin = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if has_admin == 0 {
            return DaemonState::Unclaimed;
        }
        let running: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks WHERE running = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if running > 0 {
            return DaemonState::Provisioning;
        }
        match c.query_row("SELECT v FROM meta WHERE k = 'provisioned'", [], |r| {
            r.get::<_, String>(0)
        }) {
            Ok(v) if v == "1" => DaemonState::Ready,
            _ => DaemonState::Claimed,
        }
    }

    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        self.conn()
            .execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)", (k, v))?;
        Ok(())
    }
}
