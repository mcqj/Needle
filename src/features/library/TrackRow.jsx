import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import { Box, Chip, IconButton, Typography } from '@mui/material';
import { Link } from 'react-router';
import Artwork from '../../components/Artwork';
import RatingMarks from '../../components/RatingMarks';
import { formatDate, getSourceLabel } from '../../utils/media';

export default function TrackRow({ track, index }) {
  return (
    <Box
      component="article"
      className="track-row"
    >
      <Link
        to={`/music/${track.id}`}
        className="track-row-link"
        aria-label={`View ${track.title} by ${track.artist}`}
      />
      <Typography className="track-index" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </Typography>
      <Artwork src={track.imageUrl} alt={`${track.title} artwork`} />
      <Box className="track-primary">
        <Typography component="h2" className="track-title">{track.title}</Typography>
        <Typography className="track-artist">{track.artist}</Typography>
      </Box>
      <Box className="track-category">
        <Chip label={track.category || 'Unsorted'} size="small" variant="outlined" />
      </Box>
      <Box className="track-rating">
        <RatingMarks value={track.rating || 0} compact />
      </Box>
      <Typography className="track-date">{formatDate(track.createdAt)}</Typography>
      <IconButton
        component="a"
        href={track.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${track.title} on ${getSourceLabel(track.url)}`}
        title={`Open on ${getSourceLabel(track.url)}`}
      >
        <LaunchRoundedIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}
