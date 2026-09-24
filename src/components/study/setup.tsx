import { useEffect, useMemo, useRef, useState } from 'react';

import { clearLogs, savedLogs } from '@/lib/log-store';
import {
  CONDITIONS,
  DEFAULT_SETUP,
  downloadLog,
  firstTarget,
  orderFor,
  sequencesFor,
  sincePrevious,
  type Condition,
  type SessionLog,
  type StudySetup,
  type TargetSource,
} from '@/lib/study';
import { ENGINE_DEFAULTS } from '@/lib/transition';
import { useMixStore } from '@/stores/mix';
import { useSettingsStore } from '@/stores/settings';
import { useSoundStore } from '@/stores/sound';

import type { GridCell } from '@/lib/affect';

import styles from './study.module.css';

const SETUP_KEY = 'moodist-study-setup';

/** sessions closer together than this get a warning: the protocol wants separate days */
const SAME_DAY_MS = 12 * 60 * 60 * 1000;

/** a sound in the middle of the map, for setting the device volume */
const CALIBRATION_SOUND = 'light-rain';
const CALIBRATION_MS = 20_000;

const labelOf = (id: Condition) =>
  CONDITIONS.find(c => c.id === id)?.label ?? id;

export interface ResolvedTarget {
  cell: GridCell;
  source: Exclude<TargetSource, 'participant'>;
}

interface SetupProps {
  onStart: (
    setup: StudySetup,
    order: Array<Condition>,
    /** a target set for the participant, or null if they choose */
    target: ResolvedTarget | null,
    logs: Array<SessionLog>,
  ) => void;
}

export function Setup({ onStart }: SetupProps) {
  const [setup, setSetup] = useState<StudySetup>(DEFAULT_SETUP);
  const [logs, setLogs] = useState<Array<SessionLog>>([]);
  const [calibrating, setCalibrating] = useState(false);
  const calibration = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETUP_KEY);

      if (raw) {
        const saved = { ...DEFAULT_SETUP, ...JSON.parse(raw) } as StudySetup;
        // conditions dropped from the participant study (e.g. linear)
        saved.conditions = saved.conditions.filter(id =>
          CONDITIONS.some(c => c.id === id),
        );
        setSetup(saved);
      }
    } catch {
      // first visit, or storage blocked: defaults are fine
    }

    savedLogs().then(setLogs);
  }, []);

  const update = (patch: Partial<StudySetup>) =>
    setSetup(prev => ({ ...prev, ...patch }));

  const conditions = useMemo(
    () => CONDITIONS.map(c => c.id).filter(id => setup.conditions.includes(id)),
    [setup.conditions],
  );

  const order = useMemo(
    () =>
      conditions.length ? orderFor(setup.participantNumber, conditions) : [],
    [setup.participantNumber, conditions],
  );

  const id = setup.participantId.trim();

  const target = useMemo<ResolvedTarget | null | undefined>(() => {
    if (setup.targetMode === 'fixed')
      return { cell: setup.fixedTarget, source: 'fixed' };
    if (setup.targetMode === 'choose' || setup.session <= 1) return null;

    const cell = firstTarget(logs, id);

    // undefined: needed but not found
    return cell ? { cell, source: 'first-session' } : undefined;
  }, [setup.targetMode, setup.fixedTarget, setup.session, logs, id]);

  const since = useMemo(
    () => (id ? sincePrevious(logs, id, setup.session) : null),
    [logs, id, setup.session],
  );

  const validCell = (n: number) => Number.isInteger(n) && n >= 1 && n <= 9;

  const problems = [
    !id && 'Enter a participant ID.',
    setup.participantNumber < 1 && 'Participant number starts at 1.',
    !conditions.length && 'Pick at least one condition.',
    (setup.session < 1 || setup.session > conditions.length) &&
      `Session must be between 1 and ${conditions.length}.`,
    !(setup.duration > 0) && 'Duration must be above zero.',
    setup.checkIns === 'interval' &&
      !(setup.probeInterval > 0) &&
      'Check-in interval must be above zero.',
    setup.targetMode === 'fixed' &&
      !(
        validCell(setup.fixedTarget.pleasure) &&
        validCell(setup.fixedTarget.arousal)
      ) &&
      'The fixed target needs whole numbers from 1 to 9.',
    target === undefined &&
      `No earlier session for ${id} is saved in this browser, so their first target is unknown. Choose "Fixed" and enter it.`,
  ].filter(Boolean) as Array<string>;

  const alreadyRun = logs.some(
    log => log.participantId === id && log.session === setup.session,
  );

  const stopCalibration = () => {
    if (calibration.current) clearTimeout(calibration.current);
    calibration.current = null;
    useMixStore.getState().clear();
    useSoundStore.getState().unselectAll();
    setCalibrating(false);
  };

  useEffect(
    () => () => {
      if (calibration.current) stopCalibration();
    },
    [],
  );

  const calibrate = () => {
    if (calibrating) return stopCalibration();

    useSettingsStore.getState().setGlobalVolume(setup.startVolume);
    useSoundStore.getState().prepareMix([CALIBRATION_SOUND]);
    useSoundStore.getState().play();
    useMixStore
      .getState()
      .setGains({ [CALIBRATION_SOUND]: ENGINE_DEFAULTS.masterGain });

    setCalibrating(true);
    calibration.current = setTimeout(stopCalibration, CALIBRATION_MS);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (problems.length || target === undefined) return;
    if (calibrating) stopCalibration();

    const final = { ...setup, conditions, participantId: id };

    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(final));
    } catch {
      // not essential
    }

    onStart(final, order, target, logs);
  };

  const toggleCondition = (condition: Condition) =>
    update({
      conditions: setup.conditions.includes(condition)
        ? setup.conditions.filter(c => c !== condition)
        : [...setup.conditions, condition],
    });

  const handleClear = async () => {
    if (!window.confirm('Delete every saved session log in this browser?'))
      return;

    await clearLogs();
    setLogs([]);
  };

  const number = (value: string) => Number(value);

  return (
    <div className={styles.page}>
      <p className={styles.eyebrow}>Researcher setup</p>
      <h1 className={styles.title}>Study session</h1>
      <p className={styles.lead}>
        Configure the session, then hand the device to the participant. They
        will not see the condition.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Participant ID</span>
            <input
              placeholder="P01"
              required
              type="text"
              value={setup.participantId}
              onChange={e => {
                const participantId = e.target.value;
                const digits = Number.parseInt(
                  participantId.replace(/\D+/g, ''),
                  10,
                );

                update({
                  participantId,
                  ...(digits > 0 ? { participantNumber: digits } : {}),
                });
              }}
            />
          </label>

          <label className={styles.field}>
            <span>Participant #</span>
            <input
              min={1}
              required
              type="number"
              value={setup.participantNumber}
              onChange={e =>
                update({ participantNumber: number(e.target.value) })
              }
            />
          </label>

          <label className={styles.field}>
            <span>Session</span>
            <input
              max={Math.max(1, conditions.length)}
              min={1}
              required
              type="number"
              value={setup.session}
              onChange={e => update({ session: number(e.target.value) })}
            />
          </label>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Conditions</legend>
          {CONDITIONS.map(c => (
            <label className={styles.check} key={c.id}>
              <input
                checked={setup.conditions.includes(c.id)}
                type="checkbox"
                onChange={() => toggleCondition(c.id)}
              />
              {c.label}
              <span className={styles.hint}>{c.hint}</span>
            </label>
          ))}
        </fieldset>

        {order.length > 0 && (
          <div className={styles.summary}>
            <p>
              Counterbalanced order for participant {setup.participantNumber}:
            </p>
            <ol>
              {order.map((condition, i) => (
                <li
                  className={i + 1 === setup.session ? styles.current : ''}
                  key={condition}
                >
                  {labelOf(condition)}
                  {i + 1 === setup.session && ' ← this session'}
                </li>
              ))}
            </ol>
            {order.length > 1 && (
              <p>
                A full counterbalance needs participants in multiples of{' '}
                {sequencesFor(order.length)}.
              </p>
            )}
          </div>
        )}

        <fieldset className={styles.fieldset}>
          <legend>Target</legend>
          {(
            [
              [
                'first',
                'Same as their first session',
                'they pick it in session 1; later sessions reuse it',
              ],
              ['choose', 'Participant chooses each session', ''],
              ['fixed', 'Fixed', 'e.g. to test calming down only'],
            ] as const
          ).map(([mode, label, hint]) => (
            <label className={styles.check} key={mode}>
              <input
                checked={setup.targetMode === mode}
                name="targetMode"
                type="radio"
                onChange={() => update({ targetMode: mode })}
              />
              {label}
              {hint && <span className={styles.hint}>{hint}</span>}
            </label>
          ))}

          {setup.targetMode === 'fixed' && (
            <div className={styles.row}>
              <label className={styles.field}>
                <span>Pleasantness (1–9)</span>
                <input
                  max={9}
                  min={1}
                  type="number"
                  value={setup.fixedTarget.pleasure}
                  onChange={e =>
                    update({
                      fixedTarget: {
                        ...setup.fixedTarget,
                        pleasure: number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Arousal (1–9)</span>
                <input
                  max={9}
                  min={1}
                  type="number"
                  value={setup.fixedTarget.arousal}
                  onChange={e =>
                    update({
                      fixedTarget: {
                        ...setup.fixedTarget,
                        arousal: number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
          )}

          {target?.source === 'first-session' && (
            <p className={styles.hint}>
              Reusing {id}&apos;s first target: pleasantness{' '}
              {target.cell.pleasure}, arousal {target.cell.arousal}.
            </p>
          )}

          <label className={styles.field}>
            <span>Flag start and target closer than (grid cells)</span>
            <input
              min={0}
              step={0.5}
              type="number"
              value={setup.minDistance}
              onChange={e => update({ minDistance: number(e.target.value) })}
            />
          </label>

          <label className={styles.check}>
            <input
              checked={setup.fitToMap}
              type="checkbox"
              onChange={e => update({ fitToMap: e.target.checked })}
            />
            Fit the grid to the sound map
            <span className={styles.hint}>
              the grid runs to ±1, the sounds do not
            </span>
          </label>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Listening</legend>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Listening time (min)</span>
              <input
                min={0.5}
                required
                step={0.5}
                type="number"
                value={setup.duration}
                onChange={e => update({ duration: number(e.target.value) })}
              />
            </label>

            <label className={styles.field}>
              <span>Check-ins</span>
              <select
                value={setup.checkIns}
                onChange={e =>
                  update({
                    checkIns: e.target.value as StudySetup['checkIns'],
                  })
                }
              >
                <option value="phases">Halfway and on arrival</option>
                <option value="interval">Every few minutes</option>
                <option value="none">None</option>
              </select>
            </label>

            {setup.checkIns === 'interval' && (
              <label className={styles.field}>
                <span>Every (min)</span>
                <input
                  min={0.5}
                  step={0.5}
                  type="number"
                  value={setup.probeInterval}
                  onChange={e =>
                    update({ probeInterval: number(e.target.value) })
                  }
                />
              </label>
            )}
          </div>

          <label className={styles.check}>
            <input
              checked={setup.chime}
              type="checkbox"
              onChange={e => update({ chime: e.target.checked })}
            />
            Chime when a check-in appears
            <span className={styles.hint}>for eyes-closed listening</span>
          </label>
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>After listening</legend>
          <label className={styles.check}>
            <input
              checked={setup.moodCurve}
              type="checkbox"
              onChange={e => update({ moodCurve: e.target.checked })}
            />
            Draw a mood curve of the session
          </label>

          <label className={styles.check}>
            <input
              checked={setup.ratingBlock}
              type="checkbox"
              onChange={e => update({ ratingBlock: e.target.checked })}
            />
            Rate the sounds they heard
            <span className={styles.hint}>final session only</span>
          </label>

          {setup.ratingBlock && (
            <div className={styles.row}>
              <label className={styles.field}>
                <span>Up to (sounds)</span>
                <input
                  min={1}
                  type="number"
                  value={setup.ratingCount}
                  onChange={e =>
                    update({ ratingCount: number(e.target.value) })
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Listen before rating (s)</span>
                <input
                  min={0}
                  type="number"
                  value={setup.ratingSeconds}
                  onChange={e =>
                    update({ ratingSeconds: number(e.target.value) })
                  }
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Equipment</legend>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>Headphones and device</span>
              <input
                placeholder="e.g. Sony WH-1000XM4, lab MacBook"
                type="text"
                value={setup.device}
                onChange={e => update({ device: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span>Starting volume (%)</span>
              <input
                max={100}
                min={0}
                type="number"
                value={Math.round(setup.startVolume * 100)}
                onChange={e =>
                  update({ startVolume: number(e.target.value) / 100 })
                }
              />
            </label>
          </div>

          <p className={styles.hint}>
            Play the calibration sound at this volume and set the device volume
            so it is comfortable. Leave the device volume alone from then on.{' '}
            <button className={styles.link} type="button" onClick={calibrate}>
              {calibrating
                ? 'Stop calibration sound'
                : 'Play calibration sound'}
            </button>
          </p>
        </fieldset>

        {alreadyRun && (
          <p className={styles.warning}>
            This browser already has a log for {id} session {setup.session}.
            Starting again will replace its backup copy.
          </p>
        )}

        {since !== null && since < SAME_DAY_MS && (
          <p className={styles.warning}>
            {id}&apos;s previous session ended{' '}
            {Math.max(1, Math.round(since / 60_000))} minutes ago. The protocol
            runs sessions on separate days.
          </p>
        )}

        {problems.length > 0 && (
          <ul className={styles.problems}>
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <button
          className={styles.primary}
          disabled={problems.length > 0}
          type="submit"
        >
          Start participant session
        </button>
      </form>

      {logs.length > 0 && (
        <section className={styles.logs}>
          <h2>Backed up in this browser</h2>
          <ul>
            {logs.map(log => (
              <li key={`${log.participantId}-${log.session}`}>
                <span>
                  {log.participantId} · session {log.session} · {log.condition}
                  {log.summary.completed ? '' : ' · ended early'}
                </span>
                <button type="button" onClick={() => downloadLog(log)}>
                  Download
                </button>
              </li>
            ))}
          </ul>
          <button className={styles.link} type="button" onClick={handleClear}>
            Delete saved logs
          </button>
        </section>
      )}
    </div>
  );
}
