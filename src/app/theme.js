import { createTheme } from '@mui/material/styles';

export function createAppTheme(mode) {
  const darkMode = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: darkMode ? '#7D9BFF' : '#2457F5',
        contrastText: darkMode ? '#101815' : '#FFFFFF',
      },
      secondary: { main: darkMode ? '#FF836B' : '#FA6A4B' },
      background: {
        default: darkMode ? '#121A17' : '#F3F5F4',
        paper: darkMode ? '#1B2621' : '#FFFFFF',
      },
      text: {
        primary: darkMode ? '#E8EEE9' : '#17211D',
        secondary: darkMode ? '#A6B2AC' : '#5F6964',
      },
      divider: darkMode ? '#3A4841' : '#CAD1CD',
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      h1: {
        fontFamily: '"IBM Plex Serif", serif',
        fontSize: 'clamp(2rem, 4.8vw, 4.6rem)',
        lineHeight: 0.98,
        fontWeight: 500,
        letterSpacing: 0,
      },
      h2: {
        fontFamily: '"IBM Plex Serif", serif',
        fontSize: 'clamp(1.7rem, 3vw, 3rem)',
        lineHeight: 1.08,
        fontWeight: 500,
        letterSpacing: 0,
      },
      h3: {
        fontFamily: '"IBM Plex Serif", serif',
        fontWeight: 500,
        letterSpacing: 0,
      },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    },
    components: {
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { minHeight: 42 } },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 6 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 8 } },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: 4 } },
      },
    },
  });
}
