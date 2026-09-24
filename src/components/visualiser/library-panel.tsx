import { IoEye, IoEyeOutline, IoWarning } from 'react-icons/io5/index';

import {
  coverage,
  NOT_INSTALLED,
  REGIONS,
  type Library,
} from '@/lib/libraries';
import { cn } from '@/helpers/styles';
import { getAssetPath } from '@/helpers/path';

import styles from './visualiser.module.css';

export interface Usage {
  abrupt: number;
  /** share of the route's total gain-time, 0..1 */
  airtime: number;
  sounds: number;
}

interface LibraryPanelProps {
  enabled: Set<string>;
  focus: string | null;
  libraries: Array<Library>;
  loading: boolean;
  onFocus: (id: string | null) => void;
  onToggle: (id: string) => void;
  usage: Record<string, Usage>;
}

/** clips shorter than this loop often enough to hear the repeat */
const SHORT_LOOP = 10;

/**
 * One row per library: switch it into the engine's pool, see where its
 * sounds sit on the mood map, and what the current route takes from it.
 */
export function LibraryPanel({
  enabled,
  focus,
  libraries,
  loading,
  onFocus,
  onToggle,
  usage,
}: LibraryPanelProps) {
  return (
    <section className={cn(styles.card, styles.libraries)}>
      <div className={styles.librariesHead}>
        <h2 className={styles.subtitle}>Sound libraries</h2>
        <p className={styles.hint}>
          Switch libraries into the pool the engine mixes from. Each library
          rates sounds differently, so positions from different libraries are
          not strictly comparable (hover a name for how its ratings were
          converted). Added libraries are level-matched to Moodist.
        </p>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.libraryTable}>
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col">Sounds</th>
              <th scope="col">Clip</th>
              {REGIONS.map(region => (
                <th key={region.id} scope="col" title={region.hint}>
                  {region.label}
                </th>
              ))}
              <th scope="col">On this route</th>
              <th scope="col">Airtime</th>
              <th scope="col">Abrupt</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Show on map</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {libraries.map(library => {
              const on = enabled.has(library.id);
              const counts = coverage(library);
              const use = usage[library.id];
              const silent = library.sounds.filter(s => !s.src).length;
              const short =
                library.clipSeconds !== null &&
                library.clipSeconds < SHORT_LOOP;

              return (
                <tr className={cn(!on && styles.off)} key={library.id}>
                  <th scope="row">
                    <label className={styles.libraryName}>
                      <input
                        checked={on}
                        type="checkbox"
                        onChange={() => onToggle(library.id)}
                      />
                      <span title={library.coordinates}>{library.name}</span>
                    </label>
                    <span className={styles.libraryMeta}>
                      <span title={library.licence}>
                        {library.licenceShort ?? library.licence}
                        {!library.publishable && ' · keep local'}
                      </span>
                      {short && (
                        <span className={styles.warning}>
                          <IoWarning aria-hidden="true" /> short loop
                        </span>
                      )}
                      {silent > 0 && (
                        <span className={styles.warning}>
                          <IoWarning aria-hidden="true" />{' '}
                          {silent === library.count
                            ? 'no audio yet'
                            : `${silent} without audio`}
                        </span>
                      )}
                    </span>
                  </th>
                  <td>{library.count}</td>
                  <td>
                    {library.clipSeconds === null
                      ? '—'
                      : `${library.clipSeconds}s`}
                  </td>
                  {REGIONS.map(region => (
                    <td
                      className={cn(counts[region.id] === 0 && styles.zero)}
                      key={region.id}
                    >
                      {counts[region.id]}
                    </td>
                  ))}
                  <td>{on && use ? use.sounds : '—'}</td>
                  <td>
                    {on && use ? `${Math.round(use.airtime * 100)}%` : '—'}
                  </td>
                  <td>{on && use ? use.abrupt : '—'}</td>
                  <td>
                    <button
                      aria-label={`${focus === library.id ? 'Stop highlighting' : 'Highlight'} ${library.name} on the map`}
                      aria-pressed={focus === library.id}
                      className={cn(
                        styles.iconButton,
                        focus === library.id && styles.selected,
                      )}
                      type="button"
                      onClick={() =>
                        onFocus(focus === library.id ? null : library.id)
                      }
                    >
                      {focus === library.id ? <IoEye /> : <IoEyeOutline />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {libraries.length > 1 && (
        <p className={styles.hint}>
          Credits and licences for every added library:{' '}
          <a
            className={styles.link}
            href={getAssetPath('/libraries/CREDITS.txt')}
            rel="noreferrer"
            target="_blank"
          >
            CREDITS.txt
          </a>
        </p>
      )}

      {loading && (
        <p className={styles.hint}>Looking for installed libraries…</p>
      )}

      <details className={styles.more}>
        <summary>
          Not installed yet ({NOT_INSTALLED.length}): these need access or a
          choice from you
        </summary>
        <ul>
          {NOT_INSTALLED.map(item => (
            <li key={item.name}>
              <a href={item.url} rel="noreferrer" target="_blank">
                {item.name}
              </a>
              : {item.need}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          Once you have the audio, put it in a folder with a{' '}
          <code>sounds.csv</code> (file, label, valence, arousal) and run{' '}
          <code>python3 scripts/libraries/build.py custom &lt;folder&gt;</code>.
        </p>
      </details>
    </section>
  );
}
