import path from 'path';
import fs from 'fs';

let _uploadDir: string | null = null;
const _changeCallbacks: Array<() => void> = [];

export function getUploadDir(): string {
  if (!_uploadDir) {
    _uploadDir = path.join(process.cwd(), 'uploads');
  }
  return _uploadDir;
}

export function setUploadDir(newPath: string): void {
  _uploadDir = path.resolve(newPath);
  _changeCallbacks.forEach(cb => cb());
}

export function onPathChange(cb: () => void): void {
  _changeCallbacks.push(cb);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getUploadPath(subDir?: string): string {
  if (!subDir) return getUploadDir();
  const fullPath = path.join(getUploadDir(), subDir);
  ensureDir(fullPath);
  return fullPath;
}

export function resolveFilePath(storedPath: string): string {
  const relativePath = storedPath.replace(/^\/uploads\//, '');
  return path.join(getUploadDir(), relativePath);
}

export function toWebPath(relativePath: string): string {
  return '/uploads/' + relativePath.replace(/\\/g, '/');
}

export function getUserUploadDir(userId: string): string {
  const dir = path.join(getUploadDir(), userId);
  ensureDir(dir);
  return dir;
}

export function getUploadInfo(): { effective: string } {
  return { effective: getUploadDir() };
}

const SUBDIRS = ['knowledge', 'rule-libraries', 'review-specifications', 'feedback',
  'selfcheck', 'temp', 'tmp', 'versions'];

export function initUploadSubdirs(baseDir: string): void {
  for (const dir of SUBDIRS) {
    const fullPath = path.join(baseDir, dir);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
  }
}
