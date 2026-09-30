import { createBrowserRouter } from 'react-router';
import App from './App';
import AppLayout from './AppLayout';
import RouteErrorPage from './RouteErrorPage';
import LibraryPage from '../features/library/LibraryPage';
import TrackDetailPage from '../features/detail/TrackDetailPage';

export const router = createBrowserRouter([
  {
    element: <App />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <LibraryPage /> },
          { path: 'music/:trackId', element: <TrackDetailPage /> },
          {
            path: '*',
            element: <RouteErrorPage notFound />,
          },
        ],
      },
    ],
  },
]);
