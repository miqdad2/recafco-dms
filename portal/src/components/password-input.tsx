'use client';

import { useState } from 'react';
import { fieldClass } from '@/components/ui';

/**
 * Password field with a "Show password" button. The button is a real
 * <button> (keyboard and screen reader accessible); its name says what it
 * will do ("Show password" / "Hide password") and it points at the field
 * it controls. Without JavaScript the field stays a normal password field.
 */
export function PasswordInput({
  id,
  name,
  autoComplete,
  required = true,
  describedBy,
  invalid = false,
}: {
  id: string;
  name: string;
  autoComplete: 'current-password' | 'new-password' | 'off';
  required?: boolean;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
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
        className={`${fieldClass} pr-28`}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-controls={id}
        className="absolute inset-y-1.5 right-1.5 min-w-24 rounded-lg border-2 border-line bg-white px-3 text-base font-semibold text-ink hover:border-ink"
      >
        {visible ? 'Hide' : 'Show'}
        <span className="sr-only"> password</span>
      </button>
    </div>
  );
}
