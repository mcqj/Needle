import { useState } from 'react';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded';
import {
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAtom, useAtomValue } from 'jotai';
import { Link, useNavigate, useParams } from 'react-router';
import Artwork from '../../components/Artwork';
import RatingMarks from '../../components/RatingMarks';
import { categoriesAtom, libraryAtom } from '../../state/libraryAtoms';
import { formatDate, getSourceLabel } from '../../utils/media';
import TrackDialog from '../library/TrackDialog';

export default function TrackDetailPage() {
  const { trackId } = useParams();
  const navigate = useNavigate();
  const [library, setLibrary] = useAtom(libraryAtom);
  const categories = useAtomValue(categoriesAtom);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const track = library.find((item) => item.id === trackId);

  if (!track) {
    return (
      <Container className="missing-track">
        <Typography component="h1" variant="h2">This listen isn’t in your ledger.</Typography>
        <Button component={Link} to="/" startIcon={<ArrowBackRoundedIcon />}>Back to the library</Button>
      </Container>
    );
  }

  function saveTrack(changes) {
    setLibrary((current) => current.map((item) => (
      item.id === track.id
        ? { ...item, ...changes, id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString() }
        : item
    )));
    setEditOpen(false);
  }

  function deleteTrack() {
    setLibrary((current) => current.filter((item) => item.id !== track.id));
    navigate('/');
  }

  return (
    <>
      <Container maxWidth={false} className="detail-page">
        <Button component={Link} to="/" color="inherit" startIcon={<ArrowBackRoundedIcon />}>
          Back to the ledger
        </Button>
        <Box className="detail-layout">
          <Box className="detail-art-column">
            <Artwork src={track.imageUrl} alt={`${track.title} artwork`} size="hero" />
            <Box className="detail-actions">
              <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
              <Button color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </Box>
          </Box>
          <Box className="detail-copy">
            <Box className="detail-meta-row">
              <Chip label={track.category} color="primary" />
              <Typography>Added {formatDate(track.createdAt)}</Typography>
            </Box>
            <Typography component="h1" variant="h1">{track.title}</Typography>
            <Typography component="p" className="detail-artist">{track.artist}</Typography>
            <RatingMarks value={track.rating || 0} />
            {track.review ? (
              <Typography component="blockquote" className="detail-review">{track.review}</Typography>
            ) : (
              <Typography className="detail-review detail-review-empty">No review added yet.</Typography>
            )}
            <Button
              component="a"
              href={track.url}
              target="_blank"
              rel="noreferrer"
              variant="contained"
              endIcon={<LaunchRoundedIcon />}
              className="listen-button"
            >
              Listen on {getSourceLabel(track.url)}
            </Button>
          </Box>
        </Box>
      </Container>

      {editOpen && (
        <TrackDialog
          open
          onClose={() => setEditOpen(false)}
          onSave={saveTrack}
          track={track}
          categories={categories}
        />
      )}

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this listen?</DialogTitle>
        <DialogContent>
          <Typography>“{track.title}” and its review will be removed from this device.</Typography>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setDeleteOpen(false)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={deleteTrack}>Delete</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
