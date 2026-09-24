import { useEffect, useMemo, useState } from 'react';

import {
  CONDITIONS,
  clearLogs,
  downloadLog,
  orderFor,
  savedLogs,
  type Condition,
  type SessionLog,
  type StudySetup,
} from '@/lib/study';

import styles from './study.module.css';

const SETUP_KEY = 'moodist-study-setup';

const DEFAULT_SETUP: StudySetup = {
  conditions: ['iso', 'direct'],
  duration: 10,
  participantId: '',
  participantNumber: 1,
  probeInterval: 2,
  session: 1,
};

const labelOf = (id: Condition) =>
  CONDITIONS.find(c => c.id === id)?.label ?? id;

interface SetupProps {
  onStart: (setup: StudySetup, order: Array<Condition>) => void;
}

export function Setup({ onStart }: SetupProps) {
  const [setup, setSetup] = useState<StudySetup>(DEFAULT_SETUP);
  const [logs, setLogs] = useState<Array<SessionLog>>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETUP_KEY);
      if (raw) setSetup({ ...DEFAULT_SETUP, ...JSON.parse(raw) });
    } catch {
      // first visit, or storage blocked: defaults are fine
    }

    setLogs(savedLogs());
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

  const problems = [
    !setup.participantId.trim() && 'Enter a participant ID.',
    setup.participantNumber < 1 && 'Participant number starts at 1.',
    !conditions.length && 'Pick at least one condition.',
    (setup.session < 1 || setup.session > conditions.length) &&
      `Session must be between 1 and ${conditions.length}.`,
    !(setup.duration > 0) && 'Duration must be above zero.',
    !(setup.probeInterval > 0) && 'Probe interval must be above zero.',
  ].filter(Boolean) as Array<string>;

  const alreadyRun = logs.some(
    log =>
      log.participantId === setup.participantId.trim() &&
      log.session === setup.session,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (problems.length) return;

    const final = {
      ...setup,
      conditions,
      participantId: setup.participantId.trim(),
    };

    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(final));
    } catch {
      // not essential
    }

    onStart(final, order);
  };

  const toggleCondition = (id: Condition) =>
    update({
      conditions: setup.conditions.includes(id)
        ? setup.conditions.filter(c => c !== id)
        : [...setup.conditions, id],
    });

  const handleClear = () => {
    if (!window.confirm('Delete every saved session log in this browser?'))
      return;

    clearLogs();
    setLogs([]);
  };

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
                update({ participantNumber: Number(e.target.value) })
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
              onChange={e => update({ session: Number(e.target.value) })}
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
            </label>
          ))}
        </fieldset>

        <div className={styles.row}>
          <label className={styles.field}>
            <span>Listening time (min)</span>
            <input
              min={0.5}
              required
              step={0.5}
              type="number"
              value={setup.duration}
              onChange={e => update({ duration: Number(e.target.value) })}
            />
          </label>

          <label className={styles.field}>
            <span>Check-in every (min)</span>
            <input
              min={0.5}
              required
              step={0.5}
              type="number"
              value={setup.probeInterval}
              onChange={e => update({ probeInterval: Number(e.target.value) })}
            />
          </label>
        </div>

        {order.length > 0 && (
          <div className={styles.summary}>
            <p>
              Counterbalanced order for participant {setup.participantNumber}:
            </p>
            <ol>
              {order.map((id, i) => (
                <li
                  className={i + 1 === setup.session ? styles.current : ''}
                  key={id}
                >
                  {labelOf(id)}
                  {i + 1 === setup.session && ' ← this session'}
                </li>
              ))}
            </ol>
          </div>
        )}

        {alreadyRun && (
          <p className={styles.warning}>
            This browser already has a log for {setup.participantId.trim()}{' '}
            session {setup.session}. Starting again will replace its backup
            copy.
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
          <h2>Saved in this browser</h2>
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
