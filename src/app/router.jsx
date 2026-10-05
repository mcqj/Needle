import { createBrowserRouter } from 'react-router';
import App from './App';
import AppLayout from './AppLayout';
import RouteErrorPage from './RouteErrorPage';
import LibraryPage from '../features/library/LibraryPage';
import TrackDetailPage from '../features/detail/TrackDetailPage';
import FriendsPage from '../features/friends/FriendsPage';
import RelayProvider from '../features/friends/RelayProvider';

export const router = createBrowserRouter([
  {
    element: (
      <RelayProvider>
        <App />
      </RelayProvider>
    ),
    children: [
      {
        path: '/',
        element: <AppLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <LibraryPage /> },
          { path: 'music/:trackId', element: <TrackDetailPage /> },
          { path: 'friends', element: <FriendsPage /> },
          {
            path: '*',
            element: <RouteErrorPage notFound />,
          },
        ],
      },
    ],
  },
]);
