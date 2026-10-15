'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TEMPLATES } from '../lib/templates';
import { trackToolUse } from '../lib/analytics';

export default function CreateModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="magic-modal" aria-labelledby="create-modal-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="magic-modal-inner">
        <header><div><p className="magic-eyebrow">GREAT IDEAS START SMALL</p><h2 id="create-modal-title">Find your starting point.</h2><p>Play something. Change one thing. See what happens.</p></div><button onClick={onClose} aria-label="Close game picker">×</button></header>
        <div className="magic-template-grid">
          {TEMPLATES.map((template) => (
            <button key={template.id} onClick={() => { trackToolUse('create_modal', 'select_template', template.id); onClose(); router.push(`/template/${template.id}`); }}>
              <span aria-hidden="true">{template.emoji}</span><strong>{template.title}</strong><p>{template.description}</p><small>{template.id === 'blank' ? 'Follow your imagination ↗' : 'Play & make it yours ↗'}</small>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
