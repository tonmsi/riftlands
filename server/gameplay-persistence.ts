import type { BossState } from '../shared/bosses';
import type { Account } from './store';

/** Gameplay requests saves without owning credentials, file paths or disk I/O. */
export interface GameplayPersistence {
  readonly accounts: ReadonlyMap<string, Account>;
  bossStates: Record<string, BossState>;
  touch(): void;
  flush(): void;
  flushBosses(): void;
  drain(): Promise<void>;
}
