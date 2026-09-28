// Chạy trước mỗi lần build (npm prebuild): ghi commit hiện tại vào src/app-version.ts
// để màn hình đăng nhập hiển thị bản app, so được với bản API (/version).
const { execSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

let commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || '';
if (commit) {
  commit = commit.slice(0, 7);
} else {
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'local';
  } catch {
    commit = 'local';
  }
}
writeFileSync(
  join(__dirname, '..', 'src', 'app-version.ts'),
  '// TỰ SINH LÚC BUILD (scripts/gen-version.cjs) — KHÔNG sửa tay.\n' +
  `export const APP_COMMIT: string = ${JSON.stringify(commit)};\n`
);
console.log(`[gen-version] APP_COMMIT=${commit}`);
