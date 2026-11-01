import { useEffect, useRef, useState } from 'react';
import {
  BOMBER_BLAST_RADIUS,
  CAPTURE_CHANCE,
  CITY_SIGHT,
  LOW_FUEL,
  ROUND_WIN,
  ROUND_WIN_VS_CITY,
  UNIT_TYPES,
  UNITS,
  type UnitType,
} from '@warfront/shared';
import { UnitToken } from './Icons';

const pct = (p: number) => `${Math.round(p * 100)}%`;
const DOMAIN = { land: 'Land', air: 'Air', sea: 'Sea' } as const;

const NOTES: Record<UnitType, string> = {
  tank: 'Fights units on land and captures cities by moving in. Rides transports across the sea.',
  paratrooper: 'Flies from your city like a fighter, over land or sea, but cannot attack while flying. Press Land to come down and become a tank. Landing on a city you do not own is a capture attempt.',
  fighter: 'Attacks anything: aircraft, land units and ships. Must end its turn in your city or aboard your carrier.',
  bomber: `Cannot fight. One strike destroys every unit within ${BOMBER_BLAST_RADIUS} tiles of the target, yours included, and uses up the bomber. Must end its turn in your city.`,
  transport: `Carries up to ${UNITS.transport.capacity?.count} tanks. Cannot attack; its cargo sinks with it.`,
  destroyer: 'Attacks ships. Reveals enemy submarines on the tiles next to it.',
  submarine: 'Attacks ships only, and hits hard. Hidden from enemies unless one of their destroyers is next to it.',
  battleship: 'Attacks ships and units on coastal land, even inside a city. Very tough.',
  carrier: `Carries up to ${UNITS.carrier.capacity?.count} fighters, which refuel aboard. Cannot attack.`,
};

const SECTIONS = [
  ['goal', 'Goal'],
  ['turns', 'Turns'],
  ['map', 'Map and sight'],
  ['cities', 'Cities'],
  ['units', 'Units'],
  ['moving', 'Moving'],
  ['fighting', 'Fighting'],
  ['capturing', 'Capturing cities'],
  ['air', 'Aircraft and fuel'],
  ['sea', 'Ships and transports'],
] as const;

function HelpContent() {
  return (
    <>
      <nav className="help-nav" aria-label="Help sections">
        {SECTIONS.map(([id, label]) => (
          // Scroll instead of following the link, so the page address keeps its own hash.
          <a key={id} href={`#help-${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`help-${id}`)?.scrollIntoView({ block: 'start' }); }}>{label}</a>
        ))}
      </nav>

      <section id="help-goal">
        <h3>Goal</h3>
        <p>Everyone starts with one coastal city building tanks, and no units. Build an army, take cities and wipe out the other players.</p>
        <ul>
          <li><strong>Last standing:</strong> win when you are the only player left with a city or a unit.</li>
          <li><strong>Hold a share:</strong> if the host picked it, win by owning that share of all cities at the start of two rounds in a row.</li>
        </ul>
      </section>

      <section id="help-turns">
        <h3>Turns</h3>
        <p>Players take turns in seat order; a round ends when everyone has moved. At the start of your turn every unit gets its full moves back and each of your cities works one more turn on what it is building.</p>
        <p>Press End turn when you are done. In online matches a turn timer ends your turn for you when it runs out, and bots play any empty seats.</p>
      </section>

      <section id="help-map">
        <h3>Map and sight</h3>
        <ul>
          <li><strong>Land</strong> is open to land units. <strong>Mountains</strong> block land units; aircraft fly over them. <strong>Sea</strong> is for ships and aircraft.</li>
          <li>The World map joins east to west. Regional maps have edges you cannot cross.</li>
          <li>You see {CITY_SIGHT} tiles around your cities, {UNITS.fighter.sight} around fighters and bombers, and 1 around other units. Elsewhere the map is dark.</li>
          <li>Enemies you saw before but cannot see now show as faded markers where you last saw them.</li>
          <li>With the Unexplored setting, terrain stays black until one of your units has seen it.</li>
        </ul>
      </section>

      <section id="help-cities">
        <h3>Cities</h3>
        <ul>
          <li>Each city builds one unit at a time and repeats it until you change it. Changing what a city builds starts that build from zero.</li>
          <li>Only <strong>ports</strong>, cities on the sea, build ships. Any city builds land units and aircraft.</li>
          <li>Damaged units in one of your cities repair 1 health per turn.</li>
          <li>A <strong>capital</strong> is a country's capital in real life. It is drawn bigger on the map, but it plays exactly like any other city: same production, same defence, and it counts once towards a city share.</li>
          <li>Neutral cities belong to nobody, build nothing and have no defenders.</li>
        </ul>
      </section>

      <section id="help-units">
        <h3>Units</h3>
        <p>Build times are for normal speed; Fast production halves them.</p>
        <ul className="help-units">
          {UNIT_TYPES.map((t) => {
            const u = UNITS[t];
            return (
              <li key={t}>
                <UnitToken type={t} seat={0} size={40} />
                <div>
                  <div className="help-unit-head"><strong>{u.name}</strong><span className="pill">{DOMAIN[u.domain]}</span></div>
                  <p className="help-stats">{u.domain === 'air' ? 'Fuel' : 'Moves'} {u.moves} · Health {u.hp} · Attack {u.attack || '—'} · Build {u.build} turns</p>
                  <p>{NOTES[t]}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="help-moving">
        <h3>Moving</h3>
        <ul>
          <li>Each move goes one tile in any of eight directions; diagonals cost the same.</li>
          <li>Tap a lit tile to move there, or a tile further away to follow a route over several turns.</li>
          <li>A tile holds the units of one player only, as many as you like.</li>
          <li>Sentry puts a unit to sleep so Next unit skips it. Wake it when you need it.</li>
        </ul>
      </section>

      <section id="help-fighting">
        <h3>Fighting</h3>
        <ul>
          <li>Move into a tile with enemy units to attack. Your unit fights the strongest unit there that it can hit.</li>
          <li>A fight goes in rounds until one side is destroyed. The attacker wins each round {pct(ROUND_WIN)} of the time, or {pct(ROUND_WIN_VS_CITY)} against a unit in its own city. The loser of a round loses health equal to the winner's attack.</li>
          <li>Attacking uses up the attacker's moves, and it stays where it was even if it wins.</li>
          <li>Who can hit what: tanks hit land units; fighters hit everything; destroyers and submarines hit ships; battleships hit ships and the coast. Bombers, transports, carriers and flying paratroopers never attack.</li>
        </ul>
      </section>

      <section id="help-capturing">
        <h3>Capturing cities</h3>
        <ul>
          <li>Only a <strong>tank</strong> moving in, or a <strong>paratrooper</strong> landing on it, can capture a city.</li>
          <li>A <strong>neutral</strong> city always falls.</li>
          <li>An <strong>enemy</strong> city with no land units in it falls {pct(CAPTURE_CHANCE)} of the time. If it holds out, your unit is lost.</li>
          <li>Land units defending a city must be beaten first, one fight per attack. Ships and aircraft in the city do not stop a capture and are destroyed when it falls.</li>
          <li>The unit that took the city stays in it, and the city starts building tanks for you.</li>
        </ul>
      </section>

      <section id="help-air">
        <h3>Aircraft and fuel</h3>
        <ul>
          <li>An aircraft's <strong>fuel</strong> is the moves it has left this turn. It fills up again at the start of your next turn.</li>
          <li>At the end of your turn, any aircraft not in your city (or, for fighters, aboard your carrier) flies to the nearest one it can reach with its fuel. If none is in reach, it is lost.</li>
          <li>A fighter or bomber away from a base with less than {LOW_FUEL} fuel shows an amber warning on the map and in its panel.</li>
          <li><strong>Paratroopers</strong> follow the same rule until they land. Once landed they are tanks for good.</li>
        </ul>
      </section>

      <section id="help-sea">
        <h3>Ships and transports</h3>
        <ul>
          <li>Ships stay at sea, or in your own port cities.</li>
          <li>To cross the sea, move a tank onto your transport, or press Board when both are in your port. The tanks move with the transport.</li>
          <li>To go ashore, move a tank from the transport onto land, or attack or capture straight from it. In your own port, Step ashore works too.</li>
          <li>Submarines stay hidden unless an enemy destroyer is next to them, so escort transports with destroyers.</li>
        </ul>
      </section>
    </>
  );
}

/** A Help button for a header; opens the rules in an in-page panel (browser dialogs are blocked in artifacts and Discord). */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="btn ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>Help</button>
      {open && (
        <div className="help-backdrop" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="help" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="help-head">
              <h2 id="help-title">How to play</h2>
              <button ref={close} type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="help-body">
              <HelpContent />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
