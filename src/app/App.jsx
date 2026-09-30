import { useEffect, useMemo } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { useAtomValue } from 'jotai';
import { Outlet } from 'react-router';
import { createAppTheme } from './theme';
import { colorModeAtom } from '../state/libraryAtoms';

export default function App() {
  const colorMode = useAtomValue(colorModeAtom);
  const theme = useMemo(() => createAppTheme(colorMode), [colorMode]);

  useEffect(() => {
    document.documentElement.dataset.colorMode = colorMode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      colorMode === 'dark' ? '#0B110E' : '#17211D',
    );
  }, [colorMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Outlet />
    </ThemeProvider>
  );
}
