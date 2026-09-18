import { newDungeonDraft } from '../../shared/dungeon-draft';
import { BOSS_TEMPLATES } from '../../shared/boss-templates';
export function studioDraft() {
    const draft = newDungeonDraft(); draft.id = 'studio-test'; draft.tiles[3 * draft.width] = 'path';
    draft.entities = [
        { id: 'party', kind: 'party' as const, template: '', label: 'Ingresso', x: 3, y: 3, radius: 15, level: 1 },
        { id: 'boss', kind: 'boss' as const, template: BOSS_TEMPLATES[0].id, label: 'Boss', x: 12, y: 9, radius: 28, level: 1 },
    ]; return draft;
}

