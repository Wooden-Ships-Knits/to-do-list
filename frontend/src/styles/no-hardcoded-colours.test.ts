import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(css|tsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('all colours come from CSS variables', () => {
  it('no component hard-codes a colour (only styles/tokens.css defines colours)', () => {
    const offenders: string[] = [];
    for (const file of files(root)) {
      if (file.endsWith(join('styles', 'tokens.css'))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
        if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black)\b(?!-space)/.test(code)) {
          offenders.push(`${file.replace(root, 'src')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no gradients anywhere', () => {
    const offenders = files(root).filter((f) =>
      /gradient\(/i.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')),
    );
    expect(offenders).toEqual([]);
  });
});
