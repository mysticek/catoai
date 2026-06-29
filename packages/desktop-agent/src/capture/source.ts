/**
 * CaptureSource — where Cato reads a worker's raw terminal stream from.
 * The stream is OWNED by Cato (e.g. a tmux pipe-pane file), never a worker's
 * private files. Drivers: FileTailSource now; node-pty possible later.
 */

export interface CaptureSource {
  /** Yields cleaned-of-newline lines as they appear, until close(). */
  lines(): AsyncIterable<string>;
  /** Stop tailing and release resources. */
  close(): void;
}
