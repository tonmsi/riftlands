import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { changeCatalog } from '../scripts/dungeon-removal';
import { listDungeonBackups, removeDungeonBackups } from '../scripts/dungeon-backups';

test('backup cleanup scopes operations by dungeon, including removed maps, preserving other copies and originals', async t => {
    const dir=await mkdtemp(join(tmpdir(),'riftlands-backups-')); t.after(()=>rm(dir,{recursive:true,force:true}));
    const options={catalogPath:join(dir,'catalog.json'),dataPath:join(dir,'accounts.json')};
    const data=JSON.stringify({version:2,accounts:[{id:'keep',gold:123}],bosses:{}});
    await writeFile(options.catalogPath,'[]'); await writeFile(options.dataPath,data);
    for(const id of ['first','second','first','--all']) await changeCatalog({...options,id},await readFile(options.catalogPath,'utf8'),[],[]);
    const legacy=`${options.catalogPath}.old.bak`, unrelated=join(dir,'unrelated.bak');
    await writeFile(legacy,'old copy'); await writeFile(unrelated,'untouched');
    let groups=await listDungeonBackups(options);
    assert.equal(groups.find(g=>g.scope==='dungeon:first')?.count,4);
    assert.equal(groups.find(g=>g.scope==='dungeon:second')?.count,2);
    assert.equal(groups.find(g=>g.scope==='catalog')?.count,2);
    assert.equal(groups.find(g=>g.scope==='legacy')?.count,1);
    const originals=await Promise.all([readFile(options.catalogPath,'utf8'),readFile(options.dataPath,'utf8')]);
    assert.equal((await removeDungeonBackups(options,'dungeon:first')).deletedFiles,4);
    groups=await listDungeonBackups(options);
    assert.equal(groups.some(g=>g.scope==='dungeon:first'),false);
    assert.equal(groups.find(g=>g.scope==='dungeon:second')?.count,2);
    for(const scope of ['../catalog.json','dungeon:../../x','',null])
        await assert.rejects(removeDungeonBackups(options,scope as string),/non valida/);
    assert.equal((await removeDungeonBackups(options,'legacy')).deletedFiles,1);
    assert.equal((await removeDungeonBackups(options,'all')).deletedFiles,4);
    assert.deepEqual(await listDungeonBackups(options),[]);
    assert.deepEqual(await Promise.all([readFile(options.catalogPath,'utf8'),readFile(options.dataPath,'utf8')]),originals);
    assert.equal(await readFile(unrelated,'utf8'),'untouched');
    assert.equal((await readdir(dir)).length,3);
});
