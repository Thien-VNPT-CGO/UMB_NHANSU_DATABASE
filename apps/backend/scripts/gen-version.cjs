// Chạy trước mỗi lần build (npm prebuild): ghi commit hiện tại vào src/app-version.ts
// để endpoint /version trả về commit thực tế, khớp với APP_COMMIT của 2 web app.
const { execSync } = require('node:child_process');
const { writeFileSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

let commit = process.env.GIT_COMMIT || '';
if (!commit) {
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || '';
  } catch {
    commit = '';
  }
}
const targetFile = join(__dirname, '..', 'src', 'app-version.ts');
if (!commit && existsSync(targetFile)) {
  try {
    const prev = readFileSync(targetFile, 'utf8');
    const m = prev.match(/BACKEND_COMMIT:\s*string\s*=\s*['"]([^'"]+)['"]/);
    if (m && m[1]) commit = m[1];
  } catch {}
}
if (!commit) commit = 'local-dev';

writeFileSync(
  targetFile,
  '// TỰ SINH LÚC BUILD (scripts/gen-version.cjs) — KHÔNG sửa tay.\n' +
  `export const BACKEND_COMMIT: string = ${JSON.stringify(commit)};\n`
);
console.log(`[gen-version:backend] BACKEND_COMMIT=${commit}`);
