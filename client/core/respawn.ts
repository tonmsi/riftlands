import type {Actor} from '../../shared/types';

/** Detect an authoritative respawn, including a death skipped between snapshots. */
export function didRespawn(before:Actor|null,after:Actor):boolean {
  return before?.id===after.id&&after.hp>0&&(before.hp<=0||after.deaths>before.deaths);
}
