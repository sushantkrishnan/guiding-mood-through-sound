import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  IoPause,
  IoPlay,
  IoVolumeHigh,
  IoVolumeMute,
  IoWarning,
} from 'react-icons/io5/index';

import {
  AffectGrid,
  AffectOverlay,
  cellToPoint,
  type GridCell,
  type Report,
} from '@/components/affect-grid';
import { Timeline, type Marker } from './timeline';
import { LibraryPanel, type Usage } from './library-panel';

import { fitToPool, type AffectPoint } from '@/lib/affect';
import {
  buildSchedule,
  clock,
  logSamples,
  nowPlaying,
  planSamples,
  routeStats,
  sampleAt,
  upNext,
} from '@/lib/route';
import {
  CONDITIONS,
  LOG_SCHEMA,
  savedLogs,
  type SessionLog,
} from '@/lib/study';
import {
  ENGINE_DEFAULTS,
  type EngineSettings as Engine,
  type PathShape,
  type Route,
} from '@/lib/transition';
import {
  loadLibraries,
  moodist,
  MOODIST_ID,
  categoriesOf,
  ownerIndex,
  poolOf,
  type Library,
} from '@/lib/libraries';
import * as libraryPlayer from '@/lib/library-player';
import { cn } from '@/helpers/styles';
import { useSettingsStore } from '@/stores/settings';
import { useSoundStore } from '@/stores/sound';
import { useStudyStore } from '@/stores/study';
import { waitForSounds } from '@/stores/transition';

import styles from './visualiser.module.css';

const SHAPES: Array<{ id: PathShape; label: string }> = [
  { id: 'iso', label: 'Guided (iso)' },
  { id: 'linear', label: 'Linear' },
  { id: 'drift', label: 'Drift' },
  { id: 'direct', label: 'Direct' },
];

const SPEEDS = [1, 10, 30, 60];

/** points drawn for the route line on the map */
const TRAIL_POINTS = 300;

const conditionLabel = (id: string) =>
  CONDITIONS.find(c => c.id === id)?.label ?? id;

const percent = (gain: number) => `${Math.round(gain * 100)}%`;

/** Moodist's own sounds have plain ids; every other library prefixes them */
const isMoodist = (id: string) => !id.includes(':');

const SHORT_NAMES: Record<string, string> = {
  araus: 'ARAUS',
  'emo-soundscapes': 'Emo',
  isd: 'ISD',
  nessti: 'NESSTI',
};

/**
 * Researcher tool: plan a route and see exactly what the engine will play,
 * when, and for how long — or open a study session log and replay what a
 * participant heard. Mounted by the app, inert unless the URL has
 * `?visualise` (or `?visualize` / `?viz`).
 */
export function Visualiser() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);

    setEnabled(['visualise', 'visualize', 'viz'].some(key => query.has(key)));
  }, []);

  return enabled ? <Workbench /> : null;
}

function Workbench() {
  const setActive = useStudyStore(state => state.setActive);

  const [start, setStart] = useState<GridCell>({ arousal: 8, pleasure: 2 });
  const [target, setTarget] = useState<GridCell>({ arousal: 2, pleasure: 8 });
  const [editing, setEditing] = useState<'start' | 'target'>('start');
  const [shape, setShape] = useState<PathShape>('iso');
  const [minutes, setMinutes] = useState(10);
  const [engine, setEngine] = useState<Engine>(ENGINE_DEFAULTS);
  const [fit, setFit] = useState(true);

  const [log, setLog] = useState<SessionLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Array<SessionLog>>([]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [soundOn, setSoundOn] = useState(false);
  const [soundReady, setSoundReady] = useState(false);

  const [libraries, setLibraries] = useState<Array<Library>>([moodist]);
  const [librariesLoading, setLibrariesLoading] = useState(true);
  const [enabledLibraries, setEnabledLibraries] = useState<Set<string>>(
    () => new Set([MOODIST_ID]),
  );
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    loadLibraries().then(found => {
      setLibraries(found);
      setLibrariesLoading(false);
    });
  }, []);

  const toggleLibrary = (id: string) =>
    setEnabledLibraries(previous => {
      const next = new Set(previous);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });

  const pool = useMemo(
    () => poolOf(libraries, enabledLibraries),
    [libraries, enabledLibraries],
  );
  const owners = useMemo(() => ownerIndex(libraries), [libraries]);
  const categories = useMemo(() => categoriesOf(libraries), [libraries]);

  // the regular app is underneath (it plays the audio); keep it out of the way
  useEffect(() => {
    setActive(true);
    setSaved(savedLogs());

    const previous = document.body.style.overflowY;
    document.body.style.overflowY = 'hidden';

    return () => {
      setActive(false);
      document.body.style.overflowY = previous;
    };
  }, [setActive]);

  const route = useMemo<Route>(() => {
    // the same fitting study sessions use: the grid onto what the pool covers
    const place = (cell: GridCell) =>
      fit ? fitToPool(cellToPoint(cell), pool) : cellToPoint(cell);

    return {
      ...engine,
      categories,
      duration: Math.max(0.1, minutes) * 60_000,
      pool,
      shape,
      start: place(start),
      target: place(target),
    };
  }, [engine, categories, fit, minutes, pool, shape, start, target]);

  // planning a 10-minute route is ~12k engine frames; don't block typing
  const planned = useDeferredValue(route);

  const view = useMemo(() => {
    if (log) {
      const last = log.trace.at(-1)?.t ?? 0;
      const duration = Math.max(log.config.durationMs, last, 1);
      const schedule = buildSchedule(logSamples(log), duration, {
        detectAbrupt: log.condition !== 'unguided',
        rampIn: log.config.engine.rampIn,
      });
      const toPoint = (a: { arousal: number; valence: number } | null) =>
        a ? { arousal: a.arousal, valence: a.valence } : null;

      return {
        schedule,
        start: toPoint(log.measures.pre),
        target: toPoint(log.measures.target),
      };
    }

    return {
      schedule: buildSchedule(planSamples(planned), planned.duration, {
        rampIn: planned.rampIn,
      }),
      start: planned.start,
      target: planned.target,
    };
  }, [log, planned]);

  const { schedule } = view;
  const duration = schedule.duration;
  const now = Math.min(t, duration);

  const trail = useMemo(() => {
    const positions = schedule.samples
      .map(s => s.position)
      .filter((p): p is AffectPoint => p !== null);
    const every = Math.max(1, Math.ceil(positions.length / TRAIL_POINTS));

    return positions.filter(
      (_, i) => i % every === 0 || i === positions.length - 1,
    );
  }, [schedule]);

  const sample = sampleAt(schedule, now);
  const playingNow = useMemo(() => nowPlaying(schedule, now), [schedule, now]);
  const next = useMemo(() => upNext(schedule, now), [schedule, now]);
  const stats = useMemo(
    () =>
      routeStats(schedule, view.target, {
        rampIn: log ? log.config.engine.rampIn : planned.rampIn,
      }),
    [schedule, view.target, log, planned.rampIn],
  );
  const live = useMemo(
    () => new Set(playingNow.map(p => p.lane.id)),
    [playingNow],
  );
  const laneIds = useMemo(() => schedule.lanes.map(l => l.id), [schedule]);

  // ---- playback -----------------------------------------------------------

  useEffect(() => {
    if (!playing) return;

    let frame = 0;
    let last = performance.now();

    const step = (time: number) => {
      const dt = (time - last) * speed;
      last = time;
      setT(prev => Math.min(duration, prev + dt));
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration]);

  useEffect(() => {
    if (playing && t >= duration) setPlaying(false);
  }, [playing, t, duration]);

  const togglePlay = () => {
    if (!playing && now >= duration) setT(0);

    setPlaying(p => !p);
  };

  // ---- sound: the real mixer, driven from the schedule ----------------------

  const idsKey = laneIds.join(',');

  useEffect(() => {
    if (!soundOn) return;

    let cancelled = false;
    const store = useSoundStore.getState();
    const own = laneIds.filter(isMoodist);
    const added = laneIds
      .filter(id => !isMoodist(id))
      .map(id => ({
        id,
        src: owners[id]?.sounds.find(s => s.id === id)?.src ?? null,
      }));

    setSoundReady(false);
    store.prepareMix(own);
    store.play();

    Promise.all([waitForSounds(own), libraryPlayer.prepare(added)]).then(() => {
      if (!cancelled) setSoundReady(true);
    });

    return () => {
      cancelled = true;
    };
    // laneIds and owners are captured through idsKey
  }, [soundOn, idsKey]);

  // only clear sounds this page selected, never the mix someone came in with
  const ownsMix = useRef(false);

  useEffect(() => {
    if (soundOn) {
      ownsMix.current = true;
    } else if (ownsMix.current) {
      ownsMix.current = false;
      useSoundStore.getState().unselectAll();
      libraryPlayer.stop();
    }
  }, [soundOn]);

  useEffect(
    () => () => {
      if (ownsMix.current) useSoundStore.getState().unselectAll();
      libraryPlayer.stop();
    },
    [],
  );

  const lastWrite = useRef(0);

  useEffect(() => {
    if (!soundOn) return;

    // 20Hz while playing, like the engine; every change while scrubbing
    const time = performance.now();
    if (playing && time - lastWrite.current < 45) return;
    lastWrite.current = time;

    const own: Record<string, number> = {};
    const added: Record<string, number> = {};
    laneIds.forEach(id => {
      (isMoodist(id) ? own : added)[id] = sample?.mix[id] ?? 0;
    });

    useSoundStore.getState().setVolumes(own);
    libraryPlayer.setVolumes(added, useSettingsStore.getState().globalVolume);
  }, [soundOn, playing, sample, laneIds]);

  // ---- libraries on this route -------------------------------------------

  const usage = useMemo(() => {
    const result: Record<string, Usage> = {};
    const gainTime: Record<string, number> = {};
    let total = 0;
    const { samples } = schedule;

    const ownerOf = (id: string) => owners[id]?.id ?? MOODIST_ID;

    schedule.lanes.forEach(lane => {
      const id = ownerOf(lane.id);
      result[id] ??= { abrupt: 0, airtime: 0, sounds: 0 };
      result[id].sounds++;
      result[id].abrupt += lane.segments.filter(s => s.abrupt).length;
    });

    samples.forEach((sample, i) => {
      const dt = (samples[i + 1]?.t ?? sample.t) - sample.t;
      Object.entries(sample.mix).forEach(([id, gain]) => {
        const owner = ownerOf(id);
        gainTime[owner] = (gainTime[owner] ?? 0) + gain * dt;
        total += gain * dt;
      });
    });

    Object.entries(gainTime).forEach(([id, value]) => {
      result[id] ??= { abrupt: 0, airtime: 0, sounds: 0 };
      result[id].airtime = total ? value / total : 0;
    });

    return result;
  }, [schedule, owners]);

  const focusIds = useMemo(() => {
    const library = libraries.find(l => l.id === focus);

    return new Set(library?.sounds.map(s => s.id) ?? []);
  }, [libraries, focus]);

  const tagOf = (id: string) => {
    if (isMoodist(id)) return null;
    const owner = owners[id];

    return owner ? (SHORT_NAMES[owner.id] ?? owner.name) : null;
  };

  // ---- logs ---------------------------------------------------------------

  const openLog = (next: SessionLog) => {
    setLog(next);
    setLogError(null);
    setPlaying(false);
    setT(0);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';

    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());

      if (parsed?.schema !== LOG_SCHEMA || !Array.isArray(parsed.trace)) {
        throw new Error('not a study log');
      }

      openLog(parsed as SessionLog);
    } catch {
      setLogError(`${file.name} is not a Moodist study log.`);
    }
  };

  const closeLog = () => {
    setLog(null);
    setPlaying(false);
    setT(0);
  };

  const reports = useMemo<Array<Report>>(() => {
    if (!log) return [];

    const answers: Array<Report> = [];
    const { post, pre, probes } = log.measures;

    if (pre) answers.push({ label: 'pre', point: pre });
    probes.forEach(probe => {
      if (probe.answer)
        answers.push({ label: String(probe.index + 1), point: probe.answer });
    });
    if (post) answers.push({ label: 'post', point: post });

    return answers;
  }, [log]);

  const markers = useMemo<Array<Marker>>(() => {
    if (!log) return [];

    const list: Array<Marker> = log.measures.probes
      .filter(probe => probe.shownMs !== null)
      .map(probe => ({
        label: String(probe.index + 1),
        t: probe.shownMs ?? 0,
        title: probe.answer
          ? `Check-in ${probe.index + 1} at ${clock(probe.shownMs ?? 0)}: pleasantness ${probe.answer.grid.pleasure}/9, arousal ${probe.answer.grid.arousal}/9`
          : `Check-in ${probe.index + 1} at ${clock(probe.shownMs ?? 0)}: not answered`,
      }));

    if (log.summary.exitedEarlyMs !== null) {
      list.push({
        label: 'exit',
        t: log.summary.exitedEarlyMs,
        title: `Participant ended the session at ${clock(log.summary.exitedEarlyMs)}`,
      });
    }

    return list;
  }, [log]);

  // ---- render -------------------------------------------------------------

  const segments = useMemo(
    () =>
      schedule.lanes
        .flatMap(lane => lane.segments.map(segment => ({ lane, segment })))
        .sort((a, b) => a.segment.start - b.segment.start),
    [schedule],
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Researcher tool</p>
            <h1 className={styles.title}>Route visualiser</h1>
            {log ? (
              <p className={styles.lead}>
                {log.participantId} · session {log.session} ·{' '}
                {conditionLabel(log.condition)} ·{' '}
                {new Date(log.startedAt).toLocaleString()}
                {log.summary.exitedEarlyMs !== null &&
                  ` · ended early at ${clock(log.summary.exitedEarlyMs)}`}
              </p>
            ) : (
              <p className={styles.lead}>
                Plan a route and see what the engine will play, when, and for
                how long. Everything here comes from the same code that runs
                study sessions.
              </p>
            )}
          </div>

          <div className={styles.headerActions}>
            {log ? (
              <button
                className={styles.button}
                type="button"
                onClick={closeLog}
              >
                Back to planner
              </button>
            ) : (
              <label className={styles.button}>
                Open session log…
                <input
                  accept="application/json,.json"
                  className={styles.file}
                  type="file"
                  onChange={handleFile}
                />
              </label>
            )}
          </div>
        </header>

        {logError && <p className={styles.error}>{logError}</p>}

        {!log && saved.length > 0 && (
          <div className={styles.saved}>
            <span>Saved in this browser:</span>
            {saved.map(entry => (
              <button
                className={styles.chip}
                key={`${entry.participantId}-${entry.session}`}
                type="button"
                onClick={() => openLog(entry)}
              >
                {entry.participantId} · s{entry.session}
              </button>
            ))}
          </div>
        )}

        {!log && (
          <div className={styles.controls}>
            <div
              aria-label="Path shape"
              className={styles.segmented}
              role="radiogroup"
            >
              {SHAPES.map(option => (
                <button
                  aria-checked={shape === option.id}
                  className={cn(shape === option.id && styles.selected)}
                  key={option.id}
                  role="radio"
                  type="button"
                  onClick={() => setShape(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className={styles.inline}>
              <input
                checked={fit}
                type="checkbox"
                onChange={e => setFit(e.target.checked)}
              />
              Fit grid to the map
            </label>

            <label className={styles.inline}>
              Duration
              <input
                max={60}
                min={0.5}
                step={0.5}
                type="number"
                value={minutes}
                onChange={e => setMinutes(Number(e.target.value) || 0.5)}
              />
              min
            </label>

            <details className={styles.engine}>
              <summary>Engine settings</summary>
              <EngineSettings value={engine} onChange={setEngine} />
            </details>
          </div>
        )}

        {!log && (
          <LibraryPanel
            enabled={enabledLibraries}
            focus={focus}
            libraries={libraries}
            loading={librariesLoading}
            usage={usage}
            onFocus={setFocus}
            onToggle={toggleLibrary}
          />
        )}

        <div className={styles.top}>
          <section className={styles.card}>
            {!log && (
              <div
                aria-label="Which point clicking the map sets"
                className={styles.segmented}
                role="radiogroup"
              >
                {(['start', 'target'] as const).map(which => (
                  <button
                    aria-checked={editing === which}
                    className={cn(editing === which && styles.selected)}
                    key={which}
                    role="radio"
                    type="button"
                    onClick={() => setEditing(which)}
                  >
                    Set {which}
                  </button>
                ))}
              </div>
            )}

            <AffectGrid
              label={
                log
                  ? 'Route the participant heard'
                  : `Click to set the ${editing}`
              }
              overlay={
                <AffectOverlay
                  audible={playingNow.map(p => p.lane.id)}
                  emphasis
                  highlight={log ? undefined : focusIds}
                  labels={playingNow.slice(0, 3).map(p => p.lane.id)}
                  onPath={laneIds}
                  pool={log ? undefined : pool}
                  position={sample?.position}
                  reports={reports}
                  start={view.start}
                  target={view.target}
                  trail={trail}
                />
              }
              showValue={false}
              value={log ? null : editing === 'start' ? start : target}
              onChange={
                log
                  ? undefined
                  : cell => (editing === 'start' ? setStart : setTarget)(cell)
              }
            />

            <ul className={styles.legend}>
              <li>
                <span className={cn(styles.key, styles.keyRoute)} /> Sound route
              </li>
              <li>
                <span className={cn(styles.key, styles.keyPlayhead)} /> Playhead
              </li>
              <li>
                <span className={cn(styles.key, styles.keyStart)} /> Start
              </li>
              <li>
                <span className={cn(styles.key, styles.keyTarget)} /> Target
              </li>
              {log && (
                <li>
                  <span className={cn(styles.key, styles.keyReport)} />{' '}
                  Participant&apos;s reports
                </li>
              )}
              <li>
                <span className={cn(styles.key, styles.keySound)} /> Sound in
                the pool
              </li>
              {!log && focus && (
                <li>
                  <span className={cn(styles.key, styles.keyFocus)} />{' '}
                  {libraries.find(l => l.id === focus)?.name}
                </li>
              )}
            </ul>

            <dl className={styles.stats}>
              <div>
                <dt>Sounds</dt>
                <dd>{stats.sounds}</dd>
              </div>
              <div>
                <dt>Abrupt entries</dt>
                <dd>{stats.abrupt}</dd>
              </div>
              <div>
                <dt>Reaches target</dt>
                <dd>
                  {stats.arrivesAt === null ? 'never' : clock(stats.arrivesAt)}
                </dd>
              </div>
              <div>
                <dt>Time at target</dt>
                <dd>{clock(stats.targetExposure)}</dd>
              </div>
              <div>
                <dt>Mix change</dt>
                <dd title="Summed gain change per minute, after the ramp-in">
                  {stats.change.toFixed(2)}/min
                </dd>
              </div>
            </dl>
          </section>

          <section className={cn(styles.card, styles.now)}>
            <h2 className={styles.subtitle}>
              At {clock(now)}
              <span className={styles.muted}> of {clock(duration)}</span>
            </h2>
            {sample?.position && (
              <p className={styles.muted}>
                pleasantness {sample.position.valence.toFixed(2)} · arousal{' '}
                {sample.position.arousal.toFixed(2)}
              </p>
            )}

            <h3 className={styles.listTitle}>Playing now</h3>
            {playingNow.length ? (
              <ul className={styles.list}>
                {playingNow.map(({ gain, lane, segment }) => (
                  <li className={styles.row} key={lane.id}>
                    <span className={styles.rowName}>{lane.label}</span>
                    <span aria-hidden="true" className={styles.meter}>
                      <span
                        style={{
                          width: `${(gain / Math.max(schedule.peak, 0.01)) * 100}%`,
                        }}
                      />
                    </span>
                    <span className={styles.rowValue}>{percent(gain)}</span>
                    <span className={styles.rowMeta}>
                      until {clock(segment.end)} · {clock(segment.end - now)}{' '}
                      left
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Silent.</p>
            )}

            <h3 className={styles.listTitle}>Up next</h3>
            {next.length ? (
              <ul className={styles.list}>
                {next.map(({ lane, segment }) => (
                  <li
                    className={styles.row}
                    key={`${lane.id}-${segment.start}`}
                  >
                    <span className={styles.rowWhen}>
                      {segment.start - now < 1000
                        ? 'in <1s'
                        : `in ${clock(segment.start - now)}`}
                    </span>
                    <span className={styles.rowName}>{lane.label}</span>
                    <span className={styles.rowMeta}>
                      at {clock(segment.start)} · for{' '}
                      {clock(segment.end - segment.start)} · peak{' '}
                      {percent(segment.peak)}
                      {segment.abrupt && (
                        <span className={styles.warning}>
                          <IoWarning aria-hidden="true" /> abrupt entry at{' '}
                          {percent(segment.entry)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                No more sounds come in. The mix holds to the end.
              </p>
            )}
          </section>
        </div>

        <section className={styles.card}>
          <div className={styles.transport}>
            <button
              aria-label={playing ? 'Pause' : 'Play'}
              className={styles.play}
              type="button"
              onClick={togglePlay}
            >
              {playing ? <IoPause /> : <IoPlay />}
            </button>

            <label className={styles.inline}>
              Speed
              <select
                value={speed}
                onChange={e => setSpeed(Number(e.target.value))}
              >
                {SPEEDS.map(s => (
                  <option key={s} value={s}>
                    ×{s}
                  </option>
                ))}
              </select>
            </label>

            <span className={styles.time}>
              {clock(now)} / {clock(duration)}
            </span>

            <input
              aria-label="Playhead"
              className={styles.scrubber}
              max={duration}
              min={0}
              step={100}
              type="range"
              value={now}
              onChange={e => setT(Number(e.target.value))}
            />

            <button
              aria-pressed={soundOn}
              className={cn(styles.button, soundOn && styles.selected)}
              type="button"
              onClick={() => setSoundOn(on => !on)}
            >
              {soundOn ? <IoVolumeHigh /> : <IoVolumeMute />}
              {!soundOn ? 'Sound off' : soundReady ? 'Sound on' : 'Loading…'}
            </button>
          </div>
          <p className={styles.hint}>
            With sound on at ×1 you hear exactly what a participant hears at
            that moment. Faster speeds compress the route.
          </p>

          <Timeline
            live={live}
            tagOf={tagOf}
            markers={markers}
            schedule={schedule}
            t={now}
            onSeek={setT}
          />
        </section>

        <details className={cn(styles.card, styles.table)}>
          <summary>Full schedule ({segments.length} entries)</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Sound</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col">Plays for</th>
                <th scope="col">Peak</th>
                <th scope="col">Entry</th>
              </tr>
            </thead>
            <tbody>
              {segments.map(({ lane, segment }) => (
                <tr key={`${lane.id}-${segment.start}`}>
                  <th scope="row">{lane.label}</th>
                  <td>{clock(segment.start)}</td>
                  <td>{clock(segment.end)}</td>
                  <td>{clock(segment.end - segment.start)}</td>
                  <td>{percent(segment.peak)}</td>
                  <td>
                    {segment.abrupt ? (
                      <span className={styles.warning}>
                        <IoWarning aria-hidden="true" /> abrupt,{' '}
                        {percent(segment.entry)}
                      </span>
                    ) : (
                      'fades in'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

interface EngineSettingsProps {
  onChange: (value: Engine) => void;
  value: Engine;
}

const SETTINGS: Array<{
  hint: string;
  key: keyof Engine;
  label: string;
  max: number;
  min: number;
  scale?: number;
  step: number;
  unit?: string;
}> = [
  {
    hint: 'sounds mixed at once',
    key: 'k',
    label: 'k',
    max: 10,
    min: 1,
    step: 1,
  },
  {
    hint: 'larger blends more',
    key: 'sigma',
    label: 'Kernel width σ',
    max: 1.5,
    min: 0.1,
    step: 0.05,
  },
  {
    hint: 'near-ties share the mix above this',
    key: 'crowd',
    label: 'Crowd',
    max: 0.99,
    min: 0.5,
    step: 0.01,
  },
  {
    hint: '0 = mood only; higher keeps one scene',
    key: 'coherence',
    label: 'Scene coherence',
    max: 4,
    min: 0,
    step: 0.25,
  },
  {
    hint: 'iso at start, drift at target',
    key: 'matchHold',
    label: 'Hold',
    max: 0.8,
    min: 0,
    scale: 100,
    step: 0.05,
    unit: '%',
  },
  {
    hint: 'at the target, moving paths',
    key: 'dwell',
    label: 'Dwell',
    max: 0.8,
    min: 0,
    scale: 100,
    step: 0.05,
    unit: '%',
  },
  {
    hint: 'iso never starts below this; -1 = off',
    key: 'matchValenceFloor',
    label: 'Match valence floor',
    max: 1,
    min: -1,
    step: 0.05,
  },
  {
    hint: 'loop size around the target',
    key: 'driftRadius',
    label: 'Drift radius',
    max: 0.5,
    min: 0.05,
    step: 0.01,
  },
  {
    hint: 'whole mix, constant power',
    key: 'masterGain',
    label: 'Master gain',
    max: 1,
    min: 0.1,
    scale: 100,
    step: 0.05,
    unit: '%',
  },
  {
    hint: 'fade-in, every path',
    key: 'rampIn',
    label: 'Ramp in',
    max: 10_000,
    min: 0,
    scale: 0.001,
    step: 500,
    unit: 's',
  },
];

function EngineSettings({ onChange, value }: EngineSettingsProps) {
  const changed = SETTINGS.some(s => value[s.key] !== ENGINE_DEFAULTS[s.key]);

  return (
    <div className={styles.settings}>
      {SETTINGS.map(setting => (
        <label className={styles.setting} key={setting.key}>
          <span>
            {setting.label}{' '}
            <strong>
              {Math.round(value[setting.key] * (setting.scale ?? 1) * 100) /
                100}
              {setting.unit}
            </strong>
          </span>
          <input
            max={setting.max}
            min={setting.min}
            step={setting.step}
            type="range"
            value={value[setting.key]}
            onChange={e =>
              onChange({ ...value, [setting.key]: Number(e.target.value) })
            }
          />
          <span className={styles.muted}>{setting.hint}</span>
        </label>
      ))}
      <p className={styles.hint}>
        These only change this view. Study sessions and Mood Transition always
        use the defaults.{' '}
        {changed && (
          <button
            className={styles.link}
            type="button"
            onClick={() => onChange(ENGINE_DEFAULTS)}
          >
            Reset to defaults
          </button>
        )}
      </p>
    </div>
  );
}
