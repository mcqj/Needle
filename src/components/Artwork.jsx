import MusicNoteRoundedIcon from '@mui/icons-material/MusicNoteRounded';
import { Box } from '@mui/material';

export default function Artwork({ src, alt, className = '', size = 'medium' }) {
  return (
    <Box className={`artwork artwork-${size} ${className}`}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" />
      ) : (
        <Box className="artwork-placeholder" role="img" aria-label={`${alt} artwork placeholder`}>
          <span className="record-groove" />
          <MusicNoteRoundedIcon aria-hidden="true" />
        </Box>
      )}
    </Box>
  );
}
