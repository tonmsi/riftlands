import type { ClassDef, ClassId } from './types';
export const PROTOCOL_VERSION = 4;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 10;
export const TILE_SIZE = 48;
export const CHUNK_TILES = 16;
export const CHUNK_SIZE = TILE_SIZE * CHUNK_TILES;
export const INTEREST_RADIUS = 1250;
export const PLAYER_RADIUS = 15;
export const WORLD_SEED = 734291;
export const CLASSES: Record<ClassId, ClassDef> = {
 mage: { id: 'mage', name: 'Mago', subtitle: 'Il potere dell’arcano', description: 'Controlla il campo da lontano. Dardi arcani, gelo e una nova per chi si avvicina troppo.', color: '#b3a0ed', resource: 'mana', maxHp: 110, maxResource: 120, speed: 190, armor: 0.04,
 abilities: {
 basic: { name: 'Dardo arcano', description: 'Proiettile magico direzionale.', cost: 0, cooldown: 0.5, range: 540, damage: 16, kind: 'projectile', speed: 480, radius: 6, color: '#c5afff' },
 q: { name: 'Lancia di gelo', description: 'Un proiettile che rallenta il bersaglio per 2 secondi.', cost: 24, cooldown: 3.5, range: 620, damage: 28, kind: 'projectile', speed: 440, radius: 10, color: '#91ddf4' },
 e: { name: 'Nova arcana', description: 'Danneggia i nemici intorno a te. Le pareti bloccano l’esplosione.', cost: 36, cooldown: 7, range: 135, damage: 36, kind: 'area', radius: 135, color: '#b3a0ed' },
 r: { name: 'Velo astrale', description: 'Riduce i danni del 60% per 4 secondi.', cost: 30, cooldown: 13, range: 0, damage: 0, kind: 'shield', radius: 32, duration: 4, color: '#e4c8ff' }
 } },
 warrior: { id: 'warrior', name: 'Guerriero', subtitle: 'Nel cuore della battaglia', description: 'Avvicinati, genera rabbia e scatena colpi pesanti. Più combatti, più diventi pericoloso.', color: '#edab85', resource: 'rage', maxHp: 170, maxResource: 100, speed: 205, armor: 0.15,
 abilities: {
 basic: { name: 'Fendente', description: 'Colpo frontale. Genera 12 rabbia quando colpisce.', cost: 0, cooldown: 0.55, range: 76, damage: 22, kind: 'melee', radius: 76, color: '#ffd0a0' },
 q: { name: 'Spaccaterra', description: 'Un pesante colpo a cono davanti a te.', cost: 25, cooldown: 3, range: 105, damage: 42, kind: 'melee', radius: 105, color: '#f7b278' },
 e: { name: 'Carica', description: 'Scatto direzionale di 180 unità. Si ferma sugli ostacoli.', cost: 0, cooldown: 7, range: 180, damage: 18, kind: 'dash', radius: 35, color: '#ffddab' },
 r: { name: 'Turbine', description: 'Colpisce tutti i nemici nelle vicinanze.', cost: 50, cooldown: 10, range: 120, damage: 50, kind: 'area', radius: 120, color: '#f39a71' }
 } },
 paladin: { id: 'paladin', name: 'Paladino', subtitle: 'La luce che resiste', description: 'Proteggi il tuo team, cura gli alleati e affronta i nemici con la forza della luce.', color: '#e3ce88', resource: 'mana', maxHp: 155, maxResource: 100, speed: 180, armor: 0.22,
 abilities: {
 basic: { name: 'Colpo sacro', description: 'Colpo frontale con il martello.', cost: 0, cooldown: 0.65, range: 82, damage: 21, kind: 'melee', radius: 82, color: '#f6df93' },
 q: { name: 'Giudizio', description: 'Un proiettile di luce che ferisce i nemici.', cost: 20, cooldown: 3.5, range: 410, damage: 30, kind: 'projectile', speed: 380, radius: 11, color: '#ffe5a1' },
 e: { name: 'Luce vitale', description: 'Ripristina 38 salute a te e agli alleati del team entro il cerchio.', cost: 30, cooldown: 8, range: 135, damage: 38, kind: 'heal', radius: 135, color: '#a6e5b2' },
 r: { name: 'Egida', description: 'Scudo per te e il team vicino: -60% danni per 5 secondi.', cost: 35, cooldown: 14, range: 150, damage: 0, kind: 'shield', radius: 150, duration: 5, color: '#ffecb0' }
 } },
hunter: { 
    id: 'hunter', name: 'Cacciatore', subtitle: 'Letale e silenzioso', 
    description: 'Padroneggia l’arco e le trappole naturali. Controlla il territorio e scatena raffiche a 360°.', 
    color: '#7bc876', resource: 'mana', maxHp: 130, maxResource: 100, speed: 210, armor: 0.08,
    abilities: {
      basic: { name: 'Freccia rapida', description: 'Dardo veloce a lunga gittata.', cost: 0, cooldown: 0.45, range: 600, damage: 19, kind: 'projectile', speed: 560, radius: 5, color: '#b9f0b4' },
      q: { name: 'Trappola silvana', description: 'Piazza a terra una grande trappola che scatta al passaggio nemico, infliggendo danni e bloccandolo sul posto per 2.5s.', cost: 25, cooldown: 6, range: 80, damage: 28, kind: 'trap', radius: 52, duration: 30, color: '#559c47' },
      e: { name: 'Scatto silvano', description: 'Balzo rapido nella direzione di puntamento.', cost: 0, cooldown: 6.5, range: 220, damage: 0, kind: 'dash', radius: 25, color: '#c3ffd0' },
      r: { name: 'Tempesta di frecce', description: 'Scaglia in rapida sequenza 6 frecce attorno a te a 360 gradi.', cost: 45, cooldown: 11, range: 520, damage: 25, kind: 'area', speed: 500, radius: 7, color: '#8de8a3' }
    } 
  }
};
export const PICKUP_NAMES = { heal: 'Fonte vitale', haste: 'Passo celere', power: 'Potere antico', weakness: 'Maledizione' };
export function xpForLevel(level: number): number { return level * 100; }
export function levelFromXp(xp: number): number { return 1 + Math.floor(Math.max(0, xp) / 100); }
