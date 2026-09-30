import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import { Box, Button, Container, IconButton, Tooltip, Typography } from '@mui/material';
import { useSetAtom } from 'jotai';
import { Link, useLocation, useNavigate } from 'react-router';
import { colorModeAtom } from '../state/libraryAtoms';

export default function AppShell({ children, colorMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const setColorMode = useSetAtom(colorModeAtom);
  const isLibrary = location.pathname === '/';
  const darkMode = colorMode === 'dark';

  function handleAdd() {
    if (!isLibrary) {
      navigate('/?add=1');
      return;
    }
    window.dispatchEvent(new CustomEvent('needle:add-track'));
  }

  return (
    <Box className="app-frame">
      <Box component="header" className="topbar">
        <Container maxWidth={false} className="topbar-inner">
          <Box component={Link} to="/" className="wordmark" aria-label="Needle home">
            <GraphicEqRoundedIcon aria-hidden="true" />
            <Typography component="span">Needle</Typography>
          </Box>
          <Typography className="topbar-note">Your listening ledger</Typography>
          <Box className="topbar-actions">
            <Tooltip title={`Switch to ${darkMode ? 'light' : 'dark'} mode`}>
              <IconButton
                className="mode-toggle"
                color="inherit"
                aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
                onClick={() => setColorMode(darkMode ? 'light' : 'dark')}
              >
                {darkMode ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
              </IconButton>
            </Tooltip>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddRoundedIcon />}
              onClick={handleAdd}
            >
              Add music
            </Button>
          </Box>
        </Container>
      </Box>
      <Box component="main">{children}</Box>
    </Box>
  );
}
