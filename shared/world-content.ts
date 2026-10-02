import customWorld from './custom-world.json';
import { parseWorldDocument } from './world-schema';
import { compactWorldTiles } from './world-tiles';

/** A single versioned snapshot compiled into both peers. Offline Studio writes its source file. */
export const WORLD_DOCUMENT = compactWorldTiles(parseWorldDocument(customWorld));
