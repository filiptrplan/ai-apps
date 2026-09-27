import { s, d } from "../styles.js";
import { formatTargetSummary, formatPerformedSummary } from "../format.js";
import { RANGES, collectExerciseSessions, filterByRange, metricsFor, personalRecords } from "../stats.js";
import { Segmented } from "./ExerciseForm.jsx";
import { LineChart } from "./LineChart.jsx";
import { Header, EmptyState, useIsDesktop } from "./Layout.jsx";
import { Icon } from "./Icons.jsx";

const { useState, useMemo } = React;

const shortDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Progress over time for one exercise: PR tiles, a chart of one metric per
// session, and every logged session - all limited to the chosen range.
export function ExerciseStatsPage({ exercise, history, bodyweight, backLabel, onBack, onEdit, onStart }) {
  const desktop = useIsDesktop();
  const [range, setRange] = useState("all");
  const [metricId, setMetricId] = useState(null);
  const [cursorIdx, setCursorIdx] = useState(null);

  const allSessions = useMemo(() => collectExerciseSessions(history, exercise), [history, exercise]);
  const sessions = useMemo(() => filterByRange(allSessions, range), [allSessions, range]);
  const metrics = useMemo(() => metricsFor(exercise, bodyweight), [exercise, bodyweight]);
  const metric = metrics.find(m => m.id === metricId) || metrics[0];
  const records = personalRecords(sessions, metrics);

  const times = useMemo(() => sessions.map(x => x.time), [sessions]);
  const values = useMemo(() => sessions.map(metric.value), [sessions, metric]);
  const readoutIdx = cursorIdx ?? sessions.length - 1;

  const cardStyle = desktop ? { ...s.card, marginBottom: 0 } : s.card;

  return (
    <>
      <Header
        title={exercise.name}
        subtitle={formatTargetSummary(exercise)}
        left={<button style={s.textBtn} onClick={onBack}><Icon.back size={20} /> {backLabel}</button>}
        right={<button style={s.textBtn} onClick={onEdit}>Edit</button>}
      />
      <div style={{ ...s.pageWithBottomBar, ...(desktop && d.pageWithBottomBar) }}>
        {allSessions.length === 0 ? (
          <EmptyState icon="chart" title="No sessions logged yet" text="Finish a workout with this exercise to start tracking progress." />
        ) : (
          <>
            <div style={{ ...s.segmented, marginBottom: 14, ...(desktop && { maxWidth: 360 }) }}>
              {RANGES.map(r => (
                <button
                  key={r.value}
                  style={{ ...s.segment, ...(range === r.value ? s.segmentActive : {}) }}
                  onClick={() => { setRange(r.value); setCursorIdx(null); }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {sessions.length === 0 ? (
              <div style={{ ...s.card, ...s.hint, marginBottom: 0 }}>
                No sessions in this range. Last one was {shortDate(allSessions[allSessions.length - 1].date)}.
              </div>
            ) : (
              <>
                <div style={{ ...s.stats, ...(desktop && d.stats) }}>
                  <div style={s.stat}>
                    <div style={s.statValue}>{sessions.length}</div>
                    <div style={s.statLabel}>Sessions · last {shortDate(sessions[sessions.length - 1].date)}</div>
                  </div>
                  {records.map(pr => (
                    <div key={pr.metric.id} style={s.stat}>
                      <div style={s.statValue}>{pr.metric.format(pr.value)}</div>
                      <div style={s.statLabel}>{pr.metric.label} · PR {shortDate(pr.date)}</div>
                    </div>
                  ))}
                </div>

                <div style={desktop ? d.cardGrid : undefined}>
                  <div style={cardStyle}>
                    {metrics.length > 1 && (
                      <div style={{ marginBottom: 14 }}>
                        <Segmented
                          options={metrics.map(m => ({ value: m.id, label: m.label }))}
                          value={metric.id}
                          onChange={id => { setMetricId(id); setCursorIdx(null); }}
                        />
                      </div>
                    )}
                    <div style={s.chartReadout}>
                      <span style={s.chartReadoutValue}>{metric.format(values[readoutIdx])}</span>
                      <span style={s.chartReadoutDate}>{shortDate(sessions[readoutIdx].date)}</span>
                    </div>
                    {sessions.length < 2 ? (
                      <div style={{ ...s.hint, marginBottom: 0 }}>Log another session to see a trend.</div>
                    ) : (
                      <LineChart times={times} values={values} formatAxis={metric.axis} onCursor={setCursorIdx} />
                    )}
                  </div>

                  <div>
                    <div style={s.sectionLabel}>Sessions</div>
                    {[...sessions].reverse().map(x => (
                      <div key={x.entryId} style={{ ...s.historyCard, padding: "12px 16px" }}>
                        <div style={{ ...s.rowTitle, fontSize: 15 }}>
                          {shortDate(x.date)}
                          {x.refName && <span style={s.badge}>{x.refName}</span>}
                        </div>
                        {x.performed.map((p, i) => (
                          <div key={i} style={{ ...s.historyStepValue, fontSize: 14, marginTop: 4 }}>
                            {formatPerformedSummary({ performed: p })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div style={{ ...s.bottomBar, ...(desktop && d.bottomBar) }}>
        <button style={{ ...s.btnPrimary, ...s.btnBlock, minHeight: 54, ...(desktop && d.bottomBarBtn) }} onClick={onStart}>
          <Icon.play size={18} /> Start exercise
        </button>
      </div>
    </>
  );
}
