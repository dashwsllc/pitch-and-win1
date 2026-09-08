import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !file.endsWith('package-lock.json'));

const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['Stripe secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['hard-coded password', /(?:password|senha)\s*[:=]\s*['"][^'"\n]{8,}['"]/i],
];

// Construct this separately so repositories cannot accidentally whitelist a
// real token by copying it into the scanner source.
rules.push(['hard-coded JWT', new RegExp('\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b')]);

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;
  for (const [label, pattern] of rules) {
    const match = content.match(pattern);
    if (!match) continue;
    const line = content.slice(0, match.index).split('\n').length;
    findings.push(`${file}:${line} (${label})`);
  }
}

if (findings.length) {
  console.error('Potential secrets found:\n' + findings.join('\n'));
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} repository files).`);
