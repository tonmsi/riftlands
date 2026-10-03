import type { ServerMessage } from '../../shared/types';
import { SnapshotDecoder, type SnapshotPacket } from '../../shared/snapshot-stream';

/** Raw WebSocket observers use the same reconstruction as the real client. One per socket. */
export class SnapshotObserver {
  private decoder = new SnapshotDecoder();
  read(payload: string): ServerMessage {
    const message = JSON.parse(payload) as ServerMessage | SnapshotPacket;
    if (message.type === 'welcome') this.decoder.reset();
    if (message.type === 'room') this.decoder.reset(message.room);
    return message.type === 'snapshot' && 'encoding' in message ? this.decoder.decode(message) : message;
  }
}
