import { useMemo, useState } from 'react';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Artwork from '../../components/Artwork';
import { fileToDataUrl, getAutomaticArtwork, normalizeUrl } from '../../utils/media';

const EMPTY_FORM = {
  url: '',
  title: '',
  artist: '',
  category: '',
  rating: 0,
  review: '',
  imageUrl: '',
};

export default function TrackDialog({ open, onClose, onSave, track, categories = [] }) {
  const [form, setForm] = useState(() => (track ? { ...EMPTY_FORM, ...track } : EMPTY_FORM));
  const [error, setError] = useState('');
  const [artworkMode, setArtworkMode] = useState(track?.imageUrl ? 'manual' : 'auto');

  const automaticArtwork = useMemo(() => getAutomaticArtwork(form.url), [form.url]);
  const previewArtwork = artworkMode === 'manual' ? form.imageUrl : automaticArtwork;

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file for the artwork.');
      return;
    }
    if (file.size > 2_000_000) {
      setError('Choose an image smaller than 2 MB so it can be stored on this device.');
      return;
    }

    update('imageUrl', await fileToDataUrl(file));
    setArtworkMode('manual');
    setError('');
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!form.url.trim() || !form.title.trim() || !form.artist.trim()) {
      setError('Add the link, title, and artist before saving.');
      return;
    }

    let url;
    try {
      url = normalizeUrl(form.url);
    } catch {
      setError('Enter a valid music URL.');
      return;
    }

    onSave({
      ...form,
      url,
      title: form.title.trim(),
      artist: form.artist.trim(),
      category: form.category.trim() || 'Unsorted',
      imageUrl: artworkMode === 'manual' ? form.imageUrl.trim() : automaticArtwork,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" component="form" onSubmit={handleSubmit}>
      <DialogTitle component="div" className="dialog-title">
        <Box>
          <Typography component="h2" variant="h5">
            {track ? 'Edit this listen' : 'Add to your ledger'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Keep the link. Add what you want to remember.
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close dialog">
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box className="entry-form-grid">
          <Stack spacing={2.25}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Music URL"
              value={form.url}
              onChange={(event) => update('url', event.target.value)}
              placeholder="YouTube, Spotify, Bandcamp…"
              required
              autoFocus
              fullWidth
            />
            <Box className="two-field-row">
              <TextField
                label="Title"
                value={form.title}
                onChange={(event) => update('title', event.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Artist"
                value={form.artist}
                onChange={(event) => update('artist', event.target.value)}
                required
                fullWidth
              />
            </Box>
            <Box className="two-field-row category-rating-row">
              <Autocomplete
                freeSolo
                options={categories.filter((category) => category !== 'All music')}
                value={form.category}
                onInputChange={(_, value) => update('category', value)}
                renderInput={(params) => <TextField {...params} label="Category" placeholder="Jazz, ambient, live…" />}
              />
              <Box className="rating-input">
                <Typography component="label" variant="body2">
                  Rating
                </Typography>
                <Rating
                  value={form.rating}
                  onChange={(_, value) => update('rating', value || 0)}
                  size="large"
                  aria-label="Music rating"
                />
              </Box>
            </Box>
            <TextField
              label="Review (optional)"
              value={form.review}
              onChange={(event) => update('review', event.target.value)}
              multiline
              minRows={4}
              placeholder="What stayed with you?"
              fullWidth
            />
          </Stack>

          <Box className="artwork-editor">
            <Artwork src={previewArtwork} alt={form.title || 'New music'} size="large" />
            {automaticArtwork && artworkMode === 'auto' && (
              <Box className="auto-art-label">
                <AutoAwesomeRoundedIcon fontSize="small" />
                Artwork found from the link
              </Box>
            )}
            <Stack spacing={1.25}>
              <TextField
                label="Artwork URL"
                value={artworkMode === 'manual' ? form.imageUrl : ''}
                onChange={(event) => {
                  update('imageUrl', event.target.value);
                  setArtworkMode('manual');
                }}
                placeholder="https://…"
                fullWidth
              />
              <Button component="label" variant="outlined" startIcon={<AddPhotoAlternateRoundedIcon />}>
                Choose image
                <input hidden accept="image/*" type="file" onChange={handleFile} />
              </Button>
              {artworkMode === 'manual' && automaticArtwork && (
                <Button
                  color="inherit"
                  startIcon={<AutoAwesomeRoundedIcon />}
                  onClick={() => {
                    setArtworkMode('auto');
                    update('imageUrl', '');
                  }}
                >
                  Use artwork from link
                </Button>
              )}
              {artworkMode === 'manual' && form.imageUrl && (
                <Button
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => update('imageUrl', '')}
                >
                  Remove image
                </Button>
              )}
            </Stack>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions className="dialog-actions">
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained">{track ? 'Save changes' : 'Add to ledger'}</Button>
      </DialogActions>
    </Dialog>
  );
}
