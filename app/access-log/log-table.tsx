import type { QueryLogRecord } from '@/core/ports/query-log-reader'

/**
 * The access log surface (story 3.8, UX-DR16).
 *
 * "Who asked what and when, filterable, exportable, with empty and
 * filtered-to-nothing states distinguished."
 *
 * AD-12 has been writing this record on every catalog execution since story 3.1
 * and nobody could read it. An audit trail nobody reads is a promise rather than
 * a control, and this is what turns it into something a board member can hold up
 * in a meeting.
 *
 * ## The two empty states are the criterion, not a detail
 *
 * A surface that renders one "no results" for both tells a treasurer who
 * filtered to a single member that the association has never run a query. Those
 * two facts could not be further apart, and the difference is invisible unless
 * something insists on it — which is why AC4 exists and why each test here
 * asserts the *other* state's copy is absent.
 *
 * ## Props, not fetching
 *
 * The shape `AnswerView` and `QueueList` established, for the reason story 1.6c
 * found: importing a server action pulls `next-auth` in and breaks the suite's
 * ability to load the file at all.
 */

export interface LogTableProps {
  readonly records: readonly QueryLogRecord[]

  /**
   * Whether a filter is in force.
   *
   * Passed rather than inferred from `records.length`, because the whole point
   * is that an empty result means two different things and the rows cannot tell
   * you which.
   */
  readonly filtered: boolean
}

export function LogTable({ records, filtered }: LogTableProps) {
  if (records.length === 0) {
    return filtered ? (
      <p style={styles.body}>
        No queries match this filter. The log may still hold others &mdash; clear the filter to see
        everything.
      </p>
    ) : (
      <p style={styles.body}>
        No queries have been run yet. Every question asked of the records will appear here.
      </p>
    )
  }

  return (
    <table style={styles.table}>
      <caption style={styles.caption}>
        Every question asked of the association&rsquo;s records, newest first.
      </caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Who asked</th>
          <th scope="col">What ran</th>
          <th scope="col">With</th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.id}>
            {/*
              A machine-readable timestamp alongside the shown one. `<time>`
              carries the exact instant for anything reading the page, while the
              text stays legible — and the shown form is ISO rather than a
              locale string so it sorts and cannot be read as a different date
              in another country.
            */}
            <td>
              <time dateTime={record.executedAt.toISOString()}>
                {record.executedAt.toISOString()}
              </time>
            </td>
            <td>{record.actorId}</td>
            <td>
              {record.entryId}@{record.entryVersion}
            </td>
            <td>{JSON.stringify(record.parameters)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const styles = {
  table: {
    borderCollapse: 'collapse',
    width: '100%',
  },
  caption: {
    textAlign: 'left',
    color: 'var(--color-ink-muted)',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
  },
  body: {
    margin: 0,
    maxWidth: '60ch',
  },
} as const
