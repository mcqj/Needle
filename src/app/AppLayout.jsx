import { useAtomValue } from 'jotai';
import { Outlet } from 'react-router';
import AppShell from '../components/AppShell';
import { colorModeAtom } from '../state/libraryAtoms';

export default function AppLayout() {
  const colorMode = useAtomValue(colorModeAtom);

  return (
    <AppShell colorMode={colorMode}>
      <Outlet />
    </AppShell>
  );
}
