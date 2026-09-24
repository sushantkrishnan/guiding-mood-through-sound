import { useState } from 'react';

import type { Questionnaire as Answers } from '@/lib/study';

import styles from './study.module.css';

type Scale =
  | 'coherence'
  | 'direction'
  | 'effectiveness'
  | 'monotony'
  | 'pleasantness';

/**
 * Identical wording in every condition, so framing is held constant.
 *
 * `direction` comes last and is analysed as a manipulation check, not an
 * outcome: a direct session is bound to score lower on it, and asked first
 * it would prime the rest. `monotony` (one of the ISO 12913 attributes)
 * checks whether a preference for guided is just a preference for change.
 */
const items: Array<{ id: Scale; text: string }> = [
  { id: 'pleasantness', text: 'The soundscape was pleasant to listen to.' },
  { id: 'coherence', text: 'The sounds fitted together as one scene.' },
  { id: 'monotony', text: 'The soundscape was monotonous.' },
  {
    id: 'effectiveness',
    text: 'The session helped me move towards how I wanted to feel.',
  },
  { id: 'direction', text: 'The soundscape felt like it was going somewhere.' },
];

interface QuestionnaireProps {
  onSubmit: (answers: Answers) => void;
  /** ask for a preference across sessions, which only makes sense at the end */
  sessions: number | null;
}

export function Questionnaire({ onSubmit, sessions }: QuestionnaireProps) {
  const [answers, setAnswers] = useState<Answers>({
    coherence: null,
    comments: '',
    direction: null,
    effectiveness: null,
    monotony: null,
    pleasantness: null,
    preferenceReason: '',
    preferredSession: null,
    wrongMoment: null,
    wrongMomentDetail: '',
  });

  const update = (patch: Partial<Answers>) =>
    setAnswers(prev => ({ ...prev, ...patch }));

  const complete =
    items.every(item => answers[item.id] !== null) &&
    answers.wrongMoment !== null &&
    (sessions === null || answers.preferredSession !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (complete) onSubmit(answers);
  };

  return (
    <form className={styles.questionnaire} onSubmit={handleSubmit}>
      <p className={styles.lead}>
        How much do you agree with each statement about the session you just
        heard?
      </p>

      {items.map(item => (
        <fieldset className={styles.likert} key={item.id}>
          <legend>{item.text}</legend>
          <div className={styles.scale}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <label key={n}>
                <input
                  checked={answers[item.id] === n}
                  name={item.id}
                  type="radio"
                  value={n}
                  onChange={() => update({ [item.id]: n })}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <div className={styles.anchors}>
            <span>Strongly disagree</span>
            <span>Strongly agree</span>
          </div>
        </fieldset>
      ))}

      <fieldset className={styles.likert}>
        <legend>Did any moment sound wrong or out of place?</legend>
        <div className={styles.choices}>
          {[
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ].map(choice => (
            <label key={choice.label}>
              <input
                checked={answers.wrongMoment === choice.value}
                name="wrongMoment"
                type="radio"
                onChange={() => update({ wrongMoment: choice.value })}
              />
              {choice.label}
            </label>
          ))}
        </div>
        {answers.wrongMoment && (
          <textarea
            placeholder="What did you hear, and roughly when?"
            rows={3}
            value={answers.wrongMomentDetail}
            onChange={e => update({ wrongMomentDetail: e.target.value })}
          />
        )}
      </fieldset>

      {sessions !== null && (
        <fieldset className={styles.likert}>
          <legend>
            Thinking about all {sessions} sessions, which did you prefer?
          </legend>
          <div className={styles.choices}>
            {Array.from({ length: sessions }, (_, i) => i + 1).map(n => (
              <label key={n}>
                <input
                  checked={answers.preferredSession === n}
                  name="preferredSession"
                  type="radio"
                  onChange={() => update({ preferredSession: n })}
                />
                Session {n}
                {n === sessions ? ' (this one)' : ''}
              </label>
            ))}
            <label>
              <input
                checked={answers.preferredSession === 0}
                name="preferredSession"
                type="radio"
                onChange={() => update({ preferredSession: 0 })}
              />
              No preference
            </label>
          </div>
          <textarea
            placeholder="Why? (optional)"
            rows={2}
            value={answers.preferenceReason}
            onChange={e => update({ preferenceReason: e.target.value })}
          />
        </fieldset>
      )}

      <label className={styles.field}>
        <span>Anything else you noticed? (optional)</span>
        <textarea
          rows={3}
          value={answers.comments}
          onChange={e => update({ comments: e.target.value })}
        />
      </label>

      <button className={styles.primary} disabled={!complete} type="submit">
        Submit
      </button>
    </form>
  );
}
