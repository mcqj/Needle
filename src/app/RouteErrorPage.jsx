import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { Box, Button, Container, Typography } from '@mui/material';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import BrokenRecordIllustration from '../components/BrokenRecordIllustration';

export default function RouteErrorPage({ notFound: forcedNotFound = false }) {
  const error = useRouteError();
  const notFound = forcedNotFound || (isRouteErrorResponse(error) && error.status === 404);
  const status = forcedNotFound ? 404 : (isRouteErrorResponse(error) ? error.status : 'Error');

  return (
    <Box className={`route-error-screen${forcedNotFound ? ' route-error-embedded' : ''}`}>
      {!forcedNotFound && (
        <Box component={Link} to="/" className="error-wordmark" aria-label="Needle home">
          <GraphicEqRoundedIcon aria-hidden="true" />
          <Typography component="span">Needle</Typography>
        </Box>
      )}
      <Container maxWidth="lg" className="route-error-page">
        <BrokenRecordIllustration />
        <Box className="route-error-copy">
          <Typography className="route-error-code">{status}</Typography>
          <Typography component="h1" variant="h1">
            {notFound ? 'That route missed the groove.' : 'The needle slipped.'}
          </Typography>
          <Typography className="route-error-description">
            {notFound
              ? 'This page is not in your listening ledger. Your saved music is still where you left it.'
              : 'The app hit an unexpected problem. Your saved music has not been changed.'}
          </Typography>
          <Box className="route-error-actions">
            <Button component={Link} to="/" variant="contained" startIcon={<ArrowBackRoundedIcon />}>
              Back to the ledger
            </Button>
            {!notFound && (
              <Button color="inherit" startIcon={<RefreshRoundedIcon />} onClick={() => window.location.reload()}>
                Reload the app
              </Button>
            )}
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
