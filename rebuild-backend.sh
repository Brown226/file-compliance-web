#!/bin/bash
echo "=== Step 1: Build backend image (no cache) ===" > /tmp/rebuild-backend.log
cd /mnt/e/工作/file-compliance-web
docker build --no-cache -t file-review-backend:v1.0 -f Dockerfile.backend . >> /tmp/rebuild-backend.log 2>&1
BUILD_EXIT=$?
echo "BUILD_EXIT=$BUILD_EXIT" >> /tmp/rebuild-backend.log

if [ $BUILD_EXIT -ne 0 ]; then
  echo "BUILD FAILED" >> /tmp/rebuild-backend.log
  exit 1
fi

echo "=== Step 2: Force recreate backend container ===" >> /tmp/rebuild-backend.log
cd /mnt/e/工作/file-compliance-web/offline-packages/compose-files
docker-compose -f docker-compose.offline.yml up -d --force-recreate backend >> /tmp/rebuild-backend.log 2>&1

echo "=== Step 3: Wait 25s ===" >> /tmp/rebuild-backend.log
sleep 25

echo "=== Backend logs ===" >> /tmp/rebuild-backend.log
docker logs --tail 50 file_review_backend >> /tmp/rebuild-backend.log 2>&1

echo "=== Tables in DB ===" >> /tmp/rebuild-backend.log
docker exec file_review_postgres psql -U file_review_user -d file_review_db -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;" >> /tmp/rebuild-backend.log 2>&1

echo "=== Health check ===" >> /tmp/rebuild-backend.log
docker exec file_review_backend wget --no-verbose --tries=1 --spider http://localhost:3000/health >> /tmp/rebuild-backend.log 2>&1 && echo "HEALTH OK" >> /tmp/rebuild-backend.log || echo "Health check failed" >> /tmp/rebuild-backend.log

echo "DONE" >> /tmp/rebuild-backend.log
