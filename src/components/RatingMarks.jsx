import { Box } from '@mui/material';

export default function RatingMarks({ value, compact = false }) {
  return (
    <Box
      className={`rating-marks ${compact ? 'rating-marks-compact' : ''}`}
      aria-label={`${value} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((mark) => (
        <span key={mark} className={mark <= value ? 'rating-mark-filled' : ''} />
      ))}
    </Box>
  );
}
