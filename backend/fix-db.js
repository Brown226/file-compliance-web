const { Client } = require('./node_modules/pg');
const c = new Client({ connectionString: 'postgresql://file_review_user:file_review_password@localhost:5432/file_review_db' });
(async () => {
  await c.connect();
  const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('Tables:', tables.rows.map(r => r.table_name).join(', '));
  const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='qa_messages' AND column_name='updated_at'");
  console.log('updated_at exists:', r.rows.length > 0);
  if (r.rows.length === 0) {
    await c.query("ALTER TABLE qa_messages ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()");
    console.log('added updated_at column');
  }
  await c.end();
  console.log('done');
})().catch(e => { console.error(e.message); process.exit(1); });