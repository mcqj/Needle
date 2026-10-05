import { useEffect, useMemo, useState } from 'react';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useAtom, useAtomValue } from 'jotai';
import { useSearchParams } from 'react-router';
import {
  categoriesAtom,
  categoryFilterAtom,
  libraryAtom,
  searchAtom,
  sortAtom,
} from '../../state/libraryAtoms';
import TrackDialog from './TrackDialog';
import TrackRow from './TrackRow';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'artist', label: 'Artist A–Z' },
];

export default function LibraryPage() {
  const [library, setLibrary] = useAtom(libraryAtom);
  const [search, setSearch] = useAtom(searchAtom);
  const [category, setCategory] = useAtom(categoryFilterAtom);
  const [sort, setSort] = useAtom(sortAtom);
  const categories = useAtomValue(categoriesAtom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryDialogOpen = searchParams.get('add') === '1';
  const isDialogOpen = dialogOpen || queryDialogOpen;

  useEffect(() => {
    const openDialog = () => setDialogOpen(true);
    window.addEventListener('needle:add-track', openDialog);
    return () => window.removeEventListener('needle:add-track', openDialog);
  }, []);

  useEffect(() => {
    if (!categories.includes(category)) setCategory('All music');
  }, [categories, category, setCategory]);

  const filteredTracks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = library.filter((track) => {
      const matchesCategory = category === 'All music' || track.category === category;
      const haystack = `${track.title} ${track.artist} ${track.category} ${track.review}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });

    return [...matches].sort((a, b) => {
      if (sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
      if (sort === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sort === 'artist') return a.artist.localeCompare(b.artist);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [library, search, category, sort]);

  function addTrack(track) {
    setLibrary((current) => [
      ...current,
      {
        ...track,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    closeDialog();
  }

  function closeDialog() {
    setDialogOpen(false);
    if (queryDialogOpen) setSearchParams({}, { replace: true });
  }

  return (
    <>
      <Container maxWidth={false} className="library-page">
        <Box component="section" className="library-intro">
          <Box>
            <Typography component="h1" variant="h1">Listening ledger</Typography>
            <Typography className="intro-copy">
              Keep the music that found you, and the details you want to find again.
            </Typography>
          </Box>
          <Box className="collection-count" aria-label={`${library.length} saved listens`}>
            <strong>{String(library.length).padStart(2, '0')}</strong>
            <span>{library.length === 1 ? 'saved listen' : 'saved listens'}</span>
          </Box>
        </Box>

        <Box className="library-workspace">
          <Box component="aside" className="category-rail" aria-label="Music categories">
            <Typography component="h2">Categories</Typography>
            <Box className="category-list">
              {categories.map((item) => {
                const count = item === 'All music'
                  ? library.length
                  : library.filter((track) => track.category === item).length;
                return (
                  <button
                    key={item}
                    type="button"
                    className={category === item ? 'category-button active' : 'category-button'}
                    onClick={() => setCategory(item)}
                  >
                    <span>{item}</span>
                    <span>{count}</span>
                  </button>
                );
              })}
            </Box>
          </Box>

          <Box component="section" className="ledger" aria-label="Saved music">
            <Box className="ledger-toolbar">
              <TextField
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search title, artist, category or notes"
                aria-label="Search your music"
                size="small"
                className="ledger-search"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start"><SearchRoundedIcon /></InputAdornment>
                    ),
                  },
                }}
              />
              <Box className="mobile-category-filter">
                {categories.map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    variant={category === item ? 'filled' : 'outlined'}
                    color={category === item ? 'primary' : 'default'}
                    onClick={() => setCategory(item)}
                  />
                ))}
              </Box>
              <FormControl size="small" className="sort-control">
                <Select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                  aria-label="Sort saved music"
                  startAdornment={<TuneRoundedIcon fontSize="small" />}
                >
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            {library.length === 0 ? (
              <Box className="empty-ledger">
                <Box className="sleeve-stack" aria-hidden="true">
                  <span className="sleeve sleeve-coral" />
                  <span className="sleeve sleeve-blue" />
                  <span className="sleeve sleeve-front"><i /></span>
                </Box>
                <Box>
                  <Typography component="h2" variant="h3">Start with the track still in your head.</Typography>
                  <Typography>
                    Save its link, rate the listen, and leave yourself a note for next time.
                  </Typography>
                  <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setDialogOpen(true)}>
                    Add your first listen
                  </Button>
                </Box>
              </Box>
            ) : filteredTracks.length === 0 ? (
              <Box className="no-results">
                <Typography component="h2" variant="h5">Nothing matches this view.</Typography>
                <Typography color="text.secondary">Try another search or category.</Typography>
                <Button onClick={() => { setSearch(''); setCategory('All music'); }}>Clear filters</Button>
              </Box>
            ) : (
              <Box className="track-list">
                <Box className="track-list-header" aria-hidden="true">
                  <span>No.</span><span>Artwork</span><span>Title / artist</span><span>Category</span>
                  <span>Rating</span><span>Added</span><span>Send / open</span>
                </Box>
                {filteredTracks.map((track, index) => (
                  <TrackRow key={track.id} track={track} index={index} />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      </Container>
      {isDialogOpen && (
        <TrackDialog
          open
          onClose={closeDialog}
          onSave={addTrack}
          categories={categories}
        />
      )}
    </>
  );
}
