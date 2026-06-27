// @ts-check
import sqlite3 from "sqlite3";

/**
 * App-owned persistence layer.
 *
 * ZikMetal stores ALL of its pricing data (per-product attributes and app-wide
 * settings) in its own SQLite tables — it does NOT depend on Shopify product or
 * shop metafields. This keeps the pricing engine fully self-contained: the app
 * is the single source of truth, and the storefront reads it through the App
 * Proxy. We reuse the same database file the session storage already uses.
 */

const DB_PATH = `${process.cwd()}/database.sqlite`;

let dbInstance = null;
let readyPromise = null;

function open() {
  if (dbInstance) return dbInstance;
  dbInstance = new sqlite3.Database(DB_PATH);
  return dbInstance;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    open().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    open().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    open().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/** Idempotently create the ZikMetal tables. Safe to call repeatedly. */
export function ready() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await run(`
      CREATE TABLE IF NOT EXISTS zikmetal_settings (
        shop TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await run(`
      CREATE TABLE IF NOT EXISTS zikmetal_product_config (
        shop TEXT NOT NULL,
        product_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (shop, product_id)
      )
    `);
    await run(
      `CREATE INDEX IF NOT EXISTS idx_zikmetal_cfg_shop ON zikmetal_product_config (shop)`
    );
  })();
  return readyPromise;
}

export const db = { run, get, all, ready };
export default db;
