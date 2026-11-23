import { ArrowCounterclockwise20Regular } from '@fluentui/react-icons';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { SceneId } from '@/domain/guide';
import { IconButton } from '@/ui/IconButton';

import './scenes.css';

/** A move's start, and where it goes when it travels. */
function at(ms: number, dx = 0, dy = 0): CSSProperties {
  return { animationDelay: `${ms}ms`, '--dx': `${dx}px`, '--dy': `${dy}px` } as CSSProperties;
}

/** A row of a list: a circle, a title and a line of detail. */
function Row({ y, title, detail }: { y: number; title: string; detail?: string }) {
  return (
    <g>
      <rect className="card" x="20" y={y} width="320" height="34" rx="6" />
      <circle cx="40" cy={y + 17} r="7" fill="none" className="stroke" strokeWidth="1.5" />
      <text x="56" y={y + (detail ? 15 : 21)}>
        {title}
      </text>
      {detail && (
        <text className="small" x="56" y={y + 27}>
          {detail}
        </text>
      )}
    </g>
  );
}

function Capture() {
  return (
    <>
      <rect className="card" x="20" y="18" width="320" height="38" rx="8" />
      <rect className="accent" x="20" y="54" width="320" height="2" rx="1" />
      <clipPath id="gs-typed">
        <rect className="type" x="34" y="26" width="300" height="22" style={at(150)} />
      </clipPath>
      <text x="34" y="41" clipPath="url(#gs-typed)">
        Call the bank tomorrow 3pm #Work
      </text>
      {[
        { x: 20, w: 74, label: 'Tomorrow', t: 1350 },
        { x: 100, w: 52, label: '15:00', t: 1500 },
        { x: 158, w: 54, label: 'Work', t: 1650 },
      ].map((chip) => (
        <g key={chip.label} className="pop" style={at(chip.t)}>
          <rect className="accent-soft" x={chip.x} y="66" width={chip.w} height="20" rx="10" />
          <text x={chip.x + chip.w / 2} y="80" textAnchor="middle">
            {chip.label}
          </text>
        </g>
      ))}
      <g className="drop" style={at(2200)}>
        <Row y={122} title="Call the bank" detail="Tomorrow 15:00 · Work" />
        <rect x="320" y="133" width="10" height="10" rx="3" fill="var(--tag-blue)" />
      </g>
      <text className="small fade" x="20" y="186" style={at(2400)}>
        Saved, and the line is gone.
      </text>
    </>
  );
}

function Complete() {
  return (
    <>
      <g className="leave" style={at(1500)}>
        <Row y={20} title="Send the invoice" detail="Today" />
        <circle className="success pop" cx="40" cy="37" r="7" style={at(400)} />
        <path
          className="draw"
          d="M36 37 L39 40 L44 34"
          fill="none"
          stroke="var(--color-fg-on-accent)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={at(600)}
        />
        <rect
          className="grow"
          x="56"
          y="31"
          width="98"
          height="1.5"
          fill="var(--color-fg)"
          style={at(800)}
        />
      </g>
      <g className="shift" style={at(1800, 0, -42)}>
        <Row y={62} title="Book the dentist" detail="Tomorrow" />
        <Row y={104} title="Read the contract" detail="Friday" />
      </g>
      <g className="pop" style={at(2200)}>
        <rect className="accent-soft" x="20" y="160" width="132" height="24" rx="12" />
        <text x="86" y="176" textAnchor="middle">
          1 done today
        </text>
      </g>
    </>
  );
}

function Ritual() {
  const steps = ['Left from before', 'Today', 'On the calendar'];
  return (
    <>
      <rect className="card" x="20" y="16" width="320" height="64" rx="10" />
      <circle className="caution" cx="44" cy="40" r="9" />
      <text x="62" y="36">
        Your day
      </text>
      <text className="small" x="62" y="50">
        Plan my day
      </text>
      <rect className="layer" x="44" y="66" width="272" height="3" rx="1.5" />
      <rect className="accent grow" x="44" y="66" width="272" height="3" rx="1.5" style={at(300)} />
      {steps.map((label, index) => (
        <g key={label} className="pop" style={at(400 + index * 450)}>
          <circle className="accent" cx={44 + index * 136} cy="67.5" r="6" />
          <text className="small" x={44 + index * 136} y="96" textAnchor="middle">
            {label}
          </text>
        </g>
      ))}
      <rect className="layer" x="20" y="112" width="320" height="74" rx="8" />
      {[
        { x: 40, w: 90, label: 'Write the summary', t: 1900 },
        { x: 140, w: 70, label: 'Call the bank', t: 2100 },
        { x: 220, w: 100, label: 'Review the plan', t: 2300 },
      ].map((block) => (
        <g key={block.label} className="drop" style={at(block.t)}>
          <rect className="accent" x={block.x} y="130" width={block.w} height="38" rx="6" />
          <text className="on-accent" x={block.x + 6} y="152" style={{ fontSize: 9 }}>
            {block.label}
          </text>
        </g>
      ))}
    </>
  );
}

function Replan() {
  const late = ['Pay the rent', 'Answer Ana', 'Renew the passport'];
  return (
    <>
      <text className="small" x="20" y="18">
        Late
      </text>
      <text className="small" x="214" y="18">
        Next free time
      </text>
      <rect className="layer" x="206" y="26" width="136" height="150" rx="8" />
      {late.map((title, index) => (
        <g key={title} className="travel" style={at(500 + index * 260, 190, 0)}>
          <rect className="card" x="18" y={30 + index * 46} width="130" height="36" rx="6" />
          <circle className="danger" cx="32" cy={48 + index * 46} r="4" />
          <text x="42" y={52 + index * 46} style={{ fontSize: 10 }}>
            {title}
          </text>
        </g>
      ))}
      <g className="pop" style={at(1900)}>
        <rect className="card" x="20" y="174" width="96" height="22" rx="11" />
        <text x="68" y="189" textAnchor="middle">
          Undo all
        </text>
      </g>
    </>
  );
}

function Board() {
  const columns = ['No status', 'Doing', 'Done'];
  return (
    <>
      {columns.map((name, index) => (
        <g key={name}>
          <rect className="layer" x={20 + index * 110} y="16" width="100" height="168" rx="8" />
          <text className="small" x={30 + index * 110} y="34">
            {name}
          </text>
        </g>
      ))}
      <rect className="card" x="140" y="44" width="80" height="30" rx="6" />
      <rect className="line" x="148" y="56" width="50" height="5" rx="2.5" />
      <rect className="card" x="250" y="44" width="80" height="30" rx="6" />
      <rect className="line" x="258" y="56" width="40" height="5" rx="2.5" />
      <rect className="card" x="30" y="82" width="80" height="30" rx="6" />
      <rect className="line" x="38" y="94" width="56" height="5" rx="2.5" />
      <g className="travel" style={at(500, 110, 0)}>
        <rect className="card" x="30" y="44" width="80" height="30" rx="6" />
        <rect className="accent" x="30" y="44" width="4" height="30" rx="2" />
        <text x="40" y="63" style={{ fontSize: 10 }}>
          Draft the offer
        </text>
      </g>
    </>
  );
}

function Calendar() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const blocks = [
    { day: 0, y: 50, h: 40, t: 300 },
    { day: 1, y: 90, h: 30, t: 450 },
    { day: 2, y: 40, h: 56, t: 600 },
    { day: 3, y: 110, h: 34, t: 750 },
    { day: 4, y: 60, h: 40, t: 900 },
  ];
  return (
    <>
      {days.map((day, index) => (
        <g key={day}>
          <text className="small" x={46 + index * 62} y="22" textAnchor="middle">
            {day}
          </text>
          <rect className="layer" x={18 + index * 62} y="30" width="56" height="156" rx="6" />
        </g>
      ))}
      <rect className="card" x="80" y="140" width="56" height="28" rx="5" />
      <text className="small" x="86" y="158">
        Meeting
      </text>
      {blocks.map((block) => (
        <rect
          key={block.day}
          className="accent suggest"
          x={21 + block.day * 62}
          y={block.y}
          width="50"
          height={block.h}
          rx="5"
          stroke="var(--color-accent)"
          strokeWidth="1.2"
          style={{ animationDelay: `${block.t}ms, ${1600 + block.day * 90}ms` }}
        />
      ))}
    </>
  );
}

function Mosaic() {
  const colours = ['blue', 'teal', 'purple', 'green', 'orange', 'pink', 'yellow'];
  const tiles: ReactNode[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let slot = 0; slot < 4; slot += 1) {
      const seed = (day * 5 + slot * 3) % 9;
      if (seed > 6) continue;
      tiles.push(
        <rect
          key={`${day}-${slot}`}
          className="pop"
          x={26 + day * 46}
          y={34 + slot * 36}
          width="38"
          height="30"
          rx="6"
          fill={`var(--tag-${colours[seed]})`}
          style={at(150 + (day * 4 + slot) * 60)}
        />,
      );
    }
  }
  return (
    <>
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
        <text key={index} className="small" x={45 + index * 46} y="24" textAnchor="middle">
          {day}
        </text>
      ))}
      {tiles}
    </>
  );
}

function Notes() {
  const sections = ['blue', 'green', 'orange'];
  return (
    <>
      {sections.map((colour, index) => (
        <g key={colour} className="rise" style={at(100 + index * 120)}>
          <rect className="card" x="20" y={18 + index * 34} width="84" height="26" rx="6" />
          <rect
            x="26"
            y={25 + index * 34}
            width="4"
            height="12"
            rx="2"
            fill={`var(--tag-${colour})`}
          />
          <rect className="line" x="36" y={28 + index * 34} width="52" height="5" rx="2.5" />
        </g>
      ))}
      <rect className="card" x="116" y="16" width="226" height="170" rx="8" />
      <text x="130" y="38" style={{ fontSize: 13, fontWeight: 600 }}>
        Kick-off notes
      </text>
      <rect
        className="grow"
        x="128"
        y="50"
        width="150"
        height="14"
        rx="3"
        fill="var(--tag-yellow)"
        fillOpacity="0.45"
        style={at(900)}
      />
      {[0, 1, 2].map((line) => (
        <rect
          key={line}
          className="line grow"
          x="130"
          y={54 + line * 22}
          width={[140, 180, 120][line]}
          height="6"
          rx="3"
          style={at(400 + line * 150)}
        />
      ))}
      <g className="rise" style={at(1200)}>
        <rect
          x="130"
          y="124"
          width="12"
          height="12"
          rx="3"
          fill="none"
          className="stroke"
          strokeWidth="1.5"
        />
        <rect className="line" x="150" y="127" width="120" height="6" rx="3" />
      </g>
      <rect
        className="success pop"
        x="130"
        y="124"
        width="12"
        height="12"
        rx="3"
        style={at(1700)}
      />
      <path
        className="draw"
        d="M133 130 L135.5 132.5 L139 127.5"
        fill="none"
        stroke="var(--color-fg-on-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        style={at(1850)}
      />
      <g className="pop" style={at(2100)}>
        <rect className="accent-soft" x="130" y="152" width="84" height="20" rx="10" />
        <text x="172" y="166" textAnchor="middle" style={{ fontSize: 10 }}>
          Follow up
        </text>
      </g>
    </>
  );
}

function Palette() {
  const results = ['Go to Calendar', 'Go to Today', 'New task'];
  return (
    <>
      <g className="drop" style={at(100)}>
        <rect className="card" x="50" y="16" width="260" height="168" rx="10" />
        <rect className="layer" x="62" y="28" width="236" height="28" rx="6" />
        <clipPath id="gs-query">
          <rect className="type" x="72" y="32" width="120" height="20" style={at(450)} />
        </clipPath>
        <text x="72" y="46" clipPath="url(#gs-query)">
          calendar
        </text>
      </g>
      {results.map((title, index) => (
        <g key={title} className="rise" style={at(1100 + index * 90)}>
          <text x="76" y={84 + index * 30}>
            {title}
          </text>
        </g>
      ))}
      <rect
        className="accent-soft fade"
        x="62"
        y="68"
        width="236"
        height="26"
        rx="6"
        fillOpacity="0.6"
        style={at(1450)}
      />
      <rect className="accent pop" x="62" y="72" width="3" height="18" rx="1.5" style={at(1450)} />
      <text className="small fade" x="236" y="172" style={at(1700)}>
        Enter to open
      </text>
    </>
  );
}

function Data() {
  return (
    <>
      {[2, 1, 0].map((copy) => (
        <g key={copy} className="shift" style={at(500 + (2 - copy) * 200, copy * 26, copy * -8)}>
          <rect className="card" x="120" y="44" width="92" height="116" rx="8" />
          <rect className="line" x="134" y="66" width="60" height="6" rx="3" />
          <rect className="line" x="134" y="82" width="48" height="6" rx="3" />
          <rect className="line" x="134" y="98" width="56" height="6" rx="3" />
        </g>
      ))}
      <g className="pop" style={at(1400)}>
        <path
          d="M104 118 l22 -8 l22 8 v18 c0 14 -10 22 -22 28 c-12 -6 -22 -14 -22 -28 z"
          className="success"
        />
        <path
          className="draw"
          d="M116 138 L123 145 L136 130"
          fill="none"
          stroke="var(--color-fg-on-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={at(1600)}
        />
      </g>
      <text className="small fade" x="278" y="60" style={at(1800)}>
        One file, yours
      </text>
      <text className="small fade" x="278" y="78" style={at(1950)}>
        A copy every day
      </text>
      <text className="small fade" x="278" y="96" style={at(2100)}>
        No account
      </text>
    </>
  );
}

const SCENES: Record<SceneId, { label: string; draw: () => ReactNode }> = {
  capture: {
    label: 'A line typed in quick capture becomes a task with a date and a list',
    draw: Capture,
  },
  complete: { label: 'A task is ticked, crossed out, and leaves the list', draw: Complete },
  ritual: {
    label: 'Plan my day walks three steps and puts the day’s work on the calendar',
    draw: Ritual,
  },
  replan: {
    label: 'Three late tasks move to the next free time, with one Undo for all',
    draw: Replan,
  },
  board: { label: 'A card moves from No status to Doing', draw: Board },
  calendar: {
    label: 'Suggested blocks appear dashed across the week, then are reserved',
    draw: Calendar,
  },
  mosaic: { label: 'The week fills with tiles of time, coloured by list', draw: Mosaic },
  notes: { label: 'A page fills in, a phrase is highlighted and a To do is ticked', draw: Notes },
  palette: {
    label: 'The palette opens, “calendar” is typed and Go to Calendar is chosen',
    draw: Palette,
  },
  data: { label: 'One file, copied every day, and kept on your computer', draw: Data },
};

/**
 * One of the guide's scenes. It waits until it is in view, plays once, and plays
 * again on Replay. Under reduced motion it is shown finished (scenes.css).
 */
export function GuideScene({ id }: { id: SceneId }) {
  const holder = useRef<HTMLDivElement>(null);
  // Without a way to know it is in view, a scene simply plays.
  const [state, setState] = useState<'idle' | 'playing'>(() =>
    typeof IntersectionObserver === 'undefined' ? 'playing' : 'idle',
  );
  const [take, setTake] = useState(0);
  const scene = SCENES[id];

  useEffect(() => {
    const element = holder.current;
    if (element === null || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState('playing');
          watcher.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);

  return (
    <figure
      ref={holder}
      className="gs relative m-0 overflow-hidden rounded-lg border border-stroke-subtle bg-layer p-3"
      data-state={state}
      data-scene={id}
    >
      <svg key={take} viewBox="0 0 360 200" role="img" aria-label={scene.label}>
        {scene.draw()}
      </svg>
      <figcaption className="sr-only">{scene.label}</figcaption>
      <div className="absolute right-2 top-2">
        <IconButton
          label="Replay"
          icon={<ArrowCounterclockwise20Regular />}
          onClick={() => {
            setTake((count) => count + 1);
            setState('playing');
          }}
        />
      </div>
    </figure>
  );
}
