import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installDungeon } from '../scripts/dungeon-library';
import { readCatalog, removeDungeon } from '../scripts/dungeon-removal';
import { acquireDataLease } from '../server/data-lease';
import { studioDraft } from './fixtures/studio-draft';
import { BOSS_TEMPLATES } from '../shared/boss-templates';
import { BOSS_DEFINITIONS } from '../shared/bosses';
import { DUNGEON_DEFINITIONS } from '../shared/dungeons';
import installed from '../shared/custom-dungeons.json';

test('production catalog contains only installed maps and bosses, independent of reusable templates', () => {
    const catalog = installed as { definition: { id: string }; bosses: { id: string }[] }[];
    assert.deepEqual(DUNGEON_DEFINITIONS.map(d => d.id), catalog.map(b => b.definition.id));
    assert.deepEqual(BOSS_DEFINITIONS.map(b => b.id), catalog.flatMap(b => b.bosses.map(boss => boss.id)));
    assert.equal(BOSS_TEMPLATES.length, 2);
});

test('library installs, reopens and updates source drafts without coupling templates to placed bosses', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'riftlands-library-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const options = { catalogPath: join(dir, 'catalog.json'), dataPath: join(dir, 'accounts.json') }, draft = studioDraft();
    await writeFile(options.catalogPath, '[]');
    const account = { id: 'keep', gold: 456, passwordHash: 'keep' };
    await writeFile(options.dataPath, JSON.stringify({ version: 2, accounts: [account], bosses: {} }));
    await installDungeon(draft, options);
    let catalog = await readCatalog(options.catalogPath);
    assert.deepEqual(catalog.bundles[0].draft, draft);
    assert.equal(catalog.bundles[0].bosses[0].templateId, BOSS_TEMPLATES[0].id);
    await assert.rejects(installDungeon(draft, options), /già installato/);
    const bossId = catalog.bundles[0].bosses[0].id;
    await writeFile(options.dataPath, JSON.stringify({ version: 2, accounts: [account], bosses: { [bossId]: { drops: [1] }, other: { keep: true } } }));
    draft.entities[1].x++; draft.name = 'Updated';
    await installDungeon(draft, { ...options, replace: true });
    catalog = await readCatalog(options.catalogPath);
    assert.equal(catalog.bundles.length, 1);
    assert.deepEqual(catalog.bundles[0].draft, draft);
    assert.deepEqual(JSON.parse(await readFile(options.dataPath, 'utf8')), { version: 2, accounts: [account], bosses: { other: { keep: true } } });
    await removeDungeon({ ...options, id: '--all' });
    assert.deepEqual((await readCatalog(options.catalogPath)).bundles, []);
    assert.deepEqual(JSON.parse(await readFile(options.dataPath, 'utf8')).accounts, [account]);
    assert.deepEqual(JSON.parse(await readFile(options.dataPath, 'utf8')).bosses, {});
    assert.equal(BOSS_TEMPLATES.length, 2);
});

test('offline tools cannot acquire a save already held by the server', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'riftlands-lease-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'accounts.json'), release = acquireDataLease(path);
    try { assert.throws(() => acquireDataLease(path), /Salvataggio in uso/); }
    finally { release(); }
    acquireDataLease(path)();
});
