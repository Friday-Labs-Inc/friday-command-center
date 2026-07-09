// Blueprint — the interactive Mark 1 system blueprint, framed inside the FCC shell.
// The doc is a SNAPSHOT copied from the rover repo (docs/architecture/) into
// public/blueprint-doc/ — mark1-blueprint.html + progress.js. It is self-contained
// (three.js via CDN), so we just iframe it. NOTE: re-copy both files when the
// source blueprint changes, or the embedded copy drifts from the repo source.

export function Blueprint() {
  return (
    <iframe
      title="Mark 1 System Blueprint"
      src="/blueprint-doc/mark1-blueprint.html"
      style={{
        width: '100%',
        height: 'calc(100vh - 3rem)', // viewport minus the fixed Carbon header
        border: 0,
        display: 'block',
      }}
    />
  )
}
