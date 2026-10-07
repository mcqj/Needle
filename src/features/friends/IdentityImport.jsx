import { useState } from 'react';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { describeError, importIdentityFile } from './relay-client';

/**
 * The browser path from the integration spec: when this origin has no
 * credentials yet, offer a small file input for the exported identity file
 * rather than asking anyone to paste key material anywhere.
 */
export default function IdentityImport() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await importIdentityFile(file);
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Alert severity="error">{error}</Alert>}
      <Button
        component="label"
        size="small"
        variant="outlined"
        startIcon={<FileUploadRoundedIcon />}
        disabled={busy}
      >
        Import identity file
        <input hidden type="file" accept="application/json,.json" onChange={handleFile} />
      </Button>
      <Typography variant="body2" color="text.secondary">
        {'Choose the .relay-<handle>.json file saved when the handle was registered. '
          + 'The handle is read from the file, so it does not have to match anything here.'}
      </Typography>
    </>
  );
}
