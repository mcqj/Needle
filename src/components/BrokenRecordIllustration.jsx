export default function BrokenRecordIllustration() {
  return (
    <svg
      className="broken-record"
      viewBox="0 0 640 540"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="broken-record-left" clipPathUnits="userSpaceOnUse">
          <path d="M0 0H330L294 76L339 132L296 191L342 251L289 319L337 382L299 454L324 540H0Z" />
        </clipPath>
        <clipPath id="broken-record-right" clipPathUnits="userSpaceOnUse">
          <path d="M330 0H640V540H324L299 454L337 382L289 319L342 251L296 191L339 132L294 76Z" />
        </clipPath>
      </defs>

      <g clipPath="url(#broken-record-left)" transform="translate(-24 8) rotate(-4 320 270)">
        <RecordFace />
        <path className="vinyl-crack-edge" d="M304 54L294 76L339 132L296 191L342 251L289 319L337 382L299 454L308 486" />
      </g>

      <g clipPath="url(#broken-record-right)" transform="translate(24 -8) rotate(4 320 270)">
        <RecordFace />
        <path className="vinyl-crack-edge" d="M304 54L294 76L339 132L296 191L342 251L289 319L337 382L299 454L308 486" />
      </g>
    </svg>
  );
}

function RecordFace() {
  return (
    <>
      <circle className="vinyl-disc" cx="320" cy="270" r="216" />
      {[190, 166, 142, 118, 94].map((radius) => (
        <circle key={radius} className="vinyl-groove" cx="320" cy="270" r={radius} />
      ))}
      <circle className="vinyl-label" cx="320" cy="270" r="61" />
      <circle className="vinyl-label-ring" cx="320" cy="270" r="42" />
      <circle className="vinyl-hole" cx="320" cy="270" r="9" />
    </>
  );
}
