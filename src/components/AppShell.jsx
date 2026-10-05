import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useAtom, useSetAtom } from 'jotai';
import { Link, useLocation, useNavigate } from 'react-router';
import { colorModeAtom } from '../state/libraryAtoms';
import { unseenReceivedCountAtom } from '../state/friendsAtoms';

export default function AppShell({ children, colorMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const setColorMode = useSetAtom(colorModeAtom);
  const [unseen] = useAtom(unseenReceivedCountAtom);
  const isLibrary = location.pathname === '/';
  const isFriends = location.pathname.startsWith('/friends');
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
          <Box className="topbar-nav">
            <Button
              component={Link}
              to="/"
              color="inherit"
              className={isLibrary ? 'topbar-nav-link active' : 'topbar-nav-link'}
            >
              Ledger
            </Button>
            <Button
              component={Link}
              to="/friends"
              color="inherit"
              className={isFriends ? 'topbar-nav-link active' : 'topbar-nav-link'}
              startIcon={(
                <Badge color="secondary" badgeContent={unseen} invisible={unseen === 0}>
                  <PeopleAltRoundedIcon fontSize="small" />
                </Badge>
              )}
            >
              Listening circle
            </Button>
          </Box>
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
