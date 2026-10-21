/**
 * The drift checker itself (./check-drift.cjs): it must say so when a pinned web file
 * changes, and refuse an override of a covered module that nobody pinned. The areas' own
 * *-drift.test.ts check the real pins.
 */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkCoverage, checkHashes, findWebOriginalImports, loadUpstream } from './check-drift.cjs';

const { WEB_MODULE_OVERRIDES } = require('./manifest.js') as { WEB_MODULE_OVERRIDES: Record<string, string> };

function upstreamCopy() {
  return structuredClone(loadUpstream());
}

describe('check-drift', () => {
  it('reports a pinned web file whose hash changed, and where to port it', () => {
    const upstream = upstreamCopy();
    const pin = upstream.areas.e2ee!.files['lib/e2ee/keyBackup.ts']!;
    const real = pin.sha256;
    pin.sha256 = '0'.repeat(64);
    const results = checkHashes('e2ee', { upstream });
    const keyBackup = results.find((r) => r.rel === 'lib/e2ee/keyBackup.ts')!;
    expect(keyBackup.ok).toBe(false);
    expect(keyBackup.message).toContain('web/src/lib/e2ee/keyBackup.ts changed');
    expect(keyBackup.message).toContain('src/platform/overrides/e2ee/keyBackup.ts and crypto-host/src/backup.ts');
    expect(keyBackup.message).toContain(real);
    expect(results.find((r) => r.rel === 'lib/e2ee/machine.ts')!.ok).toBe(true);
  });

  it('reports a pinned web file that no longer exists', () => {
    const upstream = upstreamCopy();
    upstream.areas.e2ee!.files['lib/e2ee/gone.ts'] = { sha256: '0'.repeat(64), port: ['src/platform/overrides/e2ee/machine.ts'] };
    const gone = checkHashes('e2ee', { upstream }).find((r) => r.rel === 'lib/e2ee/gone.ts')!;
    expect(gone.ok).toBe(false);
    expect(gone.message).toContain('no longer exists');
  });

  it('refuses an override of a covered module that is not pinned', () => {
    const overrides = { ...WEB_MODULE_OVERRIDES, 'stores/e2eeSync': 'src/platform/overrides/e2ee/e2eeSync.ts' };
    const problems = checkCoverage('e2ee', { overrides });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('web/src/stores/e2eeSync has a mobile override (src/platform/overrides/e2ee/e2eeSync.ts) but is not pinned');
  });

  it('refuses an @web-original/ wrapper of a covered module that is not pinned, unless listed as unpinned', () => {
    const webOriginalImports = new Map([['lib/e2ee/rooms', ['src/platform/e2ee/rooms.ts']]]);
    expect(checkCoverage('e2ee', { webOriginalImports })).toEqual([
      expect.stringContaining('web/src/lib/e2ee/rooms has a mobile wrapper (src/platform/e2ee/rooms.ts) but is not pinned'),
    ]);
    const upstream = upstreamCopy();
    upstream.areas.e2ee!.unpinned = { 'lib/e2ee/rooms': 'only re-exports' };
    expect(checkCoverage('e2ee', { upstream, webOriginalImports })).toEqual([]);
  });

  it("reports a pin whose port list leaves out the module's override", () => {
    const upstream = upstreamCopy();
    upstream.areas.e2ee!.files['lib/e2ee/keyBackup.ts']!.port = ['crypto-host/src/backup.ts'];
    expect(checkCoverage('e2ee', { upstream })).toEqual([
      expect.stringContaining('lib/e2ee/keyBackup.ts: its override src/platform/overrides/e2ee/keyBackup.ts is missing from `port`'),
    ]);
  });

  it('finds the wrappers in mobile code and skips tests', () => {
    const imports = findWebOriginalImports();
    expect(imports.get('lib/voice/micPipeline')).toEqual(['src/platform/voice/micPipeline.ts']);
    // Imported only by media/attachments/crypto.test.ts.
    expect(imports.has('lib/attachments/crypto')).toBe(false);
  });

  it('runs as a script: exit 0 when in step, 2 for an unknown area', () => {
    const script = path.join(__dirname, 'check-drift.cjs');
    const ok = spawnSync(process.execPath, [script, 'voice', 'e2ee'], { encoding: 'utf8' });
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^voice overrides in step with web/m);
    expect(ok.stdout).toMatch(/^e2ee overrides in step with web/m);
    expect(spawnSync(process.execPath, [script, 'nope'], { encoding: 'utf8' }).status).toBe(2);
  });
});
