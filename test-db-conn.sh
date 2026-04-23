#!/bin/sh
echo "=== Test pg module ==="
docker exec file_review_backend node -e "try { require('pg'); console.log('pg: OK'); } catch(e) { console.log('pg: MISSING - ' + e.message); }"

echo ""
echo "=== Test DB connection ==="
docker exec file_review_backend node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://file_review_user:file_review_password@postgres:5432/file_review_db' });
client.connect()
  .then(() => { console.log('DB connection: OK'); client.end(); })
  .catch(e => console.log('DB connection: FAILED - ' + e.message));
"

echo ""
echo "=== Test DNS resolve ==="
docker exec file_review_backend node -e "
const dns = require('dns');
dns.lookup('postgres', (err, addr) => {
  if (err) console.log('DNS: FAILED - ' + err.message);
  else console.log('DNS: OK - postgres=' + addr);
});
"
