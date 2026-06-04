// DuckDB connection helper. Opens (creates) the local warehouse file, applies
// the schema idempotently, and exposes small query helpers that coerce DuckDB's
// BigInt integer columns down to JS numbers.

import { DuckDBInstance } from '@duckdb/node-api'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const DB_PATH = resolve(ROOT, 'data/axie.duckdb')
const SCHEMA_PATH = resolve(ROOT, 'db/schema.sql')

function coerce(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'bigint' ? Number(v) : v
  return out
}

class Db {
  constructor(conn) {
    this.conn = conn
  }
  // DDL / statements with no result set. Schema may contain multiple statements.
  async exec(sql) {
    for (const stmt of sql.split(';')) {
      if (stmt.trim()) await this.conn.run(stmt)
    }
  }
  async run(sql) {
    return this.conn.run(sql)
  }
  async all(sql) {
    const reader = await this.conn.runAndReadAll(sql)
    return reader.getRowObjects().map(coerce)
  }
  async get(sql) {
    return (await this.all(sql))[0]
  }
  async prepare(sql) {
    return this.conn.prepare(sql)
  }
}

export async function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  const instance = await DuckDBInstance.create(DB_PATH)
  const conn = await instance.connect()
  const db = new Db(conn)
  await db.exec(readFileSync(SCHEMA_PATH, 'utf8'))
  return db
}
