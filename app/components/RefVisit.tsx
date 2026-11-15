'use client';

import { useEffect } from 'react';
import { trackEvent } from '../lib/analytics';

export default function RefVisit({ refId, known }: { refId: string; known: boolean }) {
  useEffect(() => { trackEvent('remix_ref_visit', { ref_id: refId, known }); }, [refId, known]);
  return null;
}
