import type { InputHTMLAttributes } from 'react';

export interface CommitNumberProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onBlur' | 'type'
> {
  /** The value in force (from the Brain). */
  value: number;
  /** Send the new value; reject (e.g. the Brain refused) to show the value in force again. */
  onCommit: (v: number) => Promise<unknown>;
}

/**
 * Number field that commits on blur or Enter (design: settings with an inline number). The
 * Brain validates; if it refuses, the field goes back to the value in force.
 */
export function CommitNumber({ value, onCommit, onKeyDown, ...rest }: CommitNumberProps) {
  return (
    <input
      key={value}
      type="number"
      defaultValue={value}
      {...rest}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        const input = e.currentTarget;
        const v = Number(input.value);
        if (input.value === '' || v === value) {
          input.value = String(value);
          return;
        }
        onCommit(v).catch(() => {
          input.value = String(value);
        });
      }}
    />
  );
}
