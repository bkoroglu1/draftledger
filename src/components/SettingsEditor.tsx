'use client';

import { useActionState } from 'react';
import { saveSettingsAction } from '#src/app/actions/admin.ts';

export interface EditableSetting {
  key: string;
  label: string;
  help: string;
  value: string;
  source: 'environment' | 'database' | 'default';
  envVar: string;
  locked: boolean;
}

const SOURCE_LABEL: Record<EditableSetting['source'], string> = {
  environment: 'Set by the environment',
  database: 'Set here',
  default: 'Built-in default',
};

export function SettingsEditor({ settings }: { settings: EditableSetting[] }) {
  const [state, action, pending] = useActionState(saveSettingsAction, null);
  const lockedCount = settings.filter((s) => s.locked).length;

  return (
    <form action={action} className="dl-card">
      {state?.error ? <p className="dl-error">{state.error}</p> : null}
      {state?.message ? <p className="dl-notice">{state.message}</p> : null}

      <div className="dl-form-grid">
        {settings.map((s) => (
          <div className="dl-field" key={s.key}>
            <label htmlFor={`setting-${s.key}`}>
              {s.label}{' '}
              <span className="dl-muted">({SOURCE_LABEL[s.source]})</span>
            </label>
            <input
              id={`setting-${s.key}`}
              name={s.key}
              defaultValue={s.value}
              disabled={s.locked}
              readOnly={s.locked}
              aria-describedby={`setting-${s.key}-help`}
            />
            <p className="dl-pref-hint" id={`setting-${s.key}-help`}>
              {s.help}
              {s.locked ? (
                <>
                  {' '}
                  This value comes from <span className="dl-mono">{s.envVar}</span>. Remove that
                  variable from the environment to edit it here.
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>

      <div className="dl-actions">
        <button className="dl-button dl-button-primary" disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {lockedCount > 0 ? (
        <p className="dl-notice">
          {lockedCount === 1 ? 'One setting is' : `${lockedCount} settings are`} pinned by the
          environment and cannot be changed from this screen. That is deliberate: an environment
          variable is how an operator states the value authoritatively, and accepting an edit that
          the reader would never see would be worse than refusing it.
        </p>
      ) : null}
    </form>
  );
}
