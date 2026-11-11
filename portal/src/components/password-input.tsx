'use client';

import { useState } from 'react';
import { Icon } from '@/components/icons';
import { fieldClass } from '@/components/ui';

/**
 * Password field with an eye-icon toggle inside it. The toggle is a real
 * <button> (keyboard and screen reader accessible) named "Show password" /
 * "Hide password", pointing at the field it controls, with the shared
 * focus ring. Without JavaScript the field stays a normal password field.
 */
export function PasswordInput({
  id,
  name,
  autoComplete,
  required = true,
  describedBy,
  invalid = false,
  tall = false,
}: {
  id: string;
  name: string;
  autoComplete: 'current-password' | 'new-password' | 'off';
  required?: boolean;
  describedBy?: string;
  invalid?: boolean;
  /** 52px high, for the sign-in screens. */
  tall?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Hide password' : 'Show password';
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required={required}
        maxLength={128}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={`${fieldClass} pr-14 ${tall ? 'min-h-[3.25rem]' : ''}`}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-controls={id}
        aria-label={label}
        title={label}
        className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} className="size-5" />
      </button>
    </div>
  );
}
