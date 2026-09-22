import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDungeon } from '../scripts/dungeon-removal';

async function fixture(t: TestContext) {
    const directory = await mkdtemp(join(tmpdir(), 'riftlands-remove-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const catalogPath = join(directory, 'catalog.json'), dataPath = join(directory, 'accounts.json');
    const bundles = [
        { definition: { id: 'remove-me', name: 'Test', additionalEncounters: [{ bossId: 'boss:second' }] }, bosses: [{ id: 'boss:first' }, { id: 'boss:second' }] },
        { definition: { id: 'keep-me', name: 'Keep' }, bosses: [{ id: 'boss:keep' }] },
    ];
    const data = { version: 2, accounts: [{ id: 'player', gold: 123, passwordHash: 'unchanged', body: { x: 15, y: 21 } }],
        bosses: { 'boss:first': { drops: [1] }, 'boss:second': { respawnAt: 7 }, 'boss:keep': { drops: [2] } }, extra: { keep: true } };
    const catalogText = JSON.stringify(bundles), dataText = JSON.stringify(data);
    await writeFile(catalogPath, catalogText);
    await writeFile(dataPath, dataText);
    return { directory, catalogPath, dataPath, bundles, data, catalogText, dataText, id: 'remove-me' };
}

test('removal cleans every encounter boss, preserves accounts/other dungeons and backs up both originals', async t => {
    const f = await fixture(t), result = await removeDungeon(f);
    assert.equal(result.removedStates, 2);
    assert.deepEqual(JSON.parse(await readFile(f.catalogPath, 'utf8')), [f.bundles[1]]);
    assert.deepEqual(JSON.parse(await readFile(f.dataPath, 'utf8')), { ...f.data, bosses: { 'boss:keep': f.data.bosses['boss:keep'] } });
    assert.equal(result.backups.length, 2);
    assert.equal(await readFile(result.backups[0], 'utf8'), f.catalogText);
    assert.equal(await readFile(result.backups[1], 'utf8'), f.dataText);
    assert.equal((await readdir(f.directory)).some(name => name.endsWith('.tmp')), false);
});

test('removal edits only dungeon.json after migration', async t => {
    const f = await fixture(t), dungeonPath = join(f.directory, 'dungeon.json');
    const accountText = JSON.stringify({ version: 2, accounts: f.data.accounts });
    await writeFile(f.dataPath, accountText);
    await writeFile(dungeonPath, JSON.stringify({ version: 1, bosses: f.data.bosses }));
    const result = await removeDungeon(f);
    assert.equal(result.removedStates, 2);
    assert.equal(await readFile(f.dataPath, 'utf8'), accountText);
    assert.deepEqual(JSON.parse(await readFile(dungeonPath, 'utf8')), { version: 1, bosses: { 'boss:keep': f.data.bosses['boss:keep'] } });
    assert.equal(result.backups.length, 2);
    assert.ok(result.backups.some(path => path.startsWith(dungeonPath)));
    assert.equal(result.backups.some(path => path.startsWith(f.dataPath)), false);
});

test('check previews cleanup without writing files or backups', async t => {
    const f = await fixture(t), result = await removeDungeon({ ...f, check: true });
    assert.equal(result.removedStates, 2);
    assert.deepEqual(result.backups, []);
    assert.equal(await readFile(f.catalogPath, 'utf8'), f.catalogText);
    assert.equal(await readFile(f.dataPath, 'utf8'), f.dataText);
    assert.equal((await readdir(f.directory)).length, 2);
});

test('missing save is not created; a save without matching bosses stays byte-identical', async t => {
    const f = await fixture(t);
    await rm(f.dataPath);
    const result = await removeDungeon(f);
    assert.equal(result.dataExists, false);
    assert.equal(result.backups.length, 1);
    await assert.rejects(readFile(f.dataPath), { code: 'ENOENT' });
    const g = await fixture(t), text = JSON.stringify({ ...g.data, bosses: {} }, null, 4);
    await writeFile(g.dataPath, text);
    assert.equal((await removeDungeon(g)).removedStates, 0);
    assert.equal(await readFile(g.dataPath, 'utf8'), text);
});

test('unknown IDs, unsupported saves and malformed JSON fail before any change', async t => {
    const f = await fixture(t);
    await assert.rejects(removeDungeon({ ...f, id: 'not-installed' }), /non trovato/);
    for (const text of ['{', '{"version":1,"accounts":[]}', '{"version":2,"accounts":[],"bosses":[]}']) {
        await writeFile(f.dataPath, text);
        await assert.rejects(removeDungeon(f));
        assert.equal(await readFile(f.catalogPath, 'utf8'), f.catalogText);
        assert.equal(await readFile(f.dataPath, 'utf8'), text);
        assert.equal((await readdir(f.directory)).length, 2);
    }
});

test('duplicate catalog boss ownership is rejected before cleanup', async t => {
    const f = await fixture(t);
    f.bundles[1].bosses[0].id = 'boss:first';
    const text = JSON.stringify(f.bundles);
    await writeFile(f.catalogPath, text);
    await assert.rejects(removeDungeon(f), /duplicati/);
    assert.equal(await readFile(f.catalogPath, 'utf8'), text);
    assert.equal(await readFile(f.dataPath, 'utf8'), f.dataText);
});

test('removing the last installed dungeon leaves an empty catalog', async t => {
    const f = await fixture(t);
    await writeFile(f.catalogPath, JSON.stringify([f.bundles[0]]));
    await removeDungeon(f);
    assert.deepEqual(JSON.parse(await readFile(f.catalogPath, 'utf8')), []);
});
