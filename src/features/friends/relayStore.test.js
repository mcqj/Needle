import { describe, expect, it, vi } from 'vitest';
import { serialiseProvenance } from './relayStore';

// serialiseProvenance turns the SDK's render decision into plain, storable
// data. It never keeps the fetchOriginal function; the message id stands in
// for it, so the relay can be asked again later.
const relay = (summary) => ({ provenanceSummary: vi.fn(() => summary) });

describe('serialiseProvenance', () => {
  it('records a plain message as plain', () => {
    const result = serialiseProvenance(relay({ kind: 'plain' }), { id: 'm1' });
    expect(result).toEqual({ kind: 'plain', messageId: 'm1' });
  });

  it('keeps the badge and the dropped/assumed lists for a translated message', () => {
    const fetchOriginal = vi.fn();
    const result = serialiseProvenance(relay({
      kind: 'translated',
      badge: 'translated from "album-pick"',
      dropped: ['mood'],
      assumed: ['category'],
      fetchOriginal,
    }), { id: 'm2' });

    expect(result).toEqual({
      kind: 'translated',
      messageId: 'm2',
      badge: 'translated from "album-pick"',
      dropped: ['mood'],
      assumed: ['category'],
    });
    // Functions cannot survive storage, so they must not be kept.
    expect(result.fetchOriginal).toBeUndefined();
  });

  it('defaults the lists when the relay omits them', () => {
    const result = serialiseProvenance(relay({
      kind: 'translated',
      badge: 'translated',
    }), { id: 'm3' });
    expect(result.dropped).toEqual([]);
    expect(result.assumed).toEqual([]);
  });

  it('keeps the note, failure and page for an untranslated message', () => {
    const result = serialiseProvenance(relay({
      kind: 'untranslated',
      note: 'their shape, not ours',
      failure: 'no transform yet',
      page: '/m/m4',
    }), { id: 'm4' });

    expect(result).toEqual({
      kind: 'untranslated',
      messageId: 'm4',
      note: 'their shape, not ours',
      failure: 'no transform yet',
      page: '/m/m4',
    });
  });

  it('falls back to plain when the SDK cannot decide', () => {
    const broken = { provenanceSummary: () => { throw new Error('boom'); } };
    expect(serialiseProvenance(broken, { id: 'm5' })).toEqual({ kind: 'plain', messageId: 'm5' });
  });
});
