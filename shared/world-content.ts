import customWorld from './custom-world.json';
import { parseWorldDocument } from './world-schema';

/** A single versioned snapshot compiled into both peers. Offline Studio writes its source file. */
export const WORLD_DOCUMENT = parseWorldDocument(customWorld);
