import { ACTOR_CATALOG, type ActorCatalog } from '../../shared/actor-catalog';
let catalog = ACTOR_CATALOG;
export const npcContentCatalog = () => catalog;
export function setNpcContentCatalog(value: ActorCatalog): void { catalog = value; }
