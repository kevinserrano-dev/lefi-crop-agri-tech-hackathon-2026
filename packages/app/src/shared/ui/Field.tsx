import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import styles from './Field.module.css';

/** Compact select (design: filters, owner). */
export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={`${styles.select} ${className ?? ''}`} {...rest}>
      {children}
    </select>
  );
}

export function SearchInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={styles.search}>
      <Icon name="search" size={18} color="var(--lefi-text-muted)" />
      <input type="search" {...props} />
    </div>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${styles.textarea} ${className ?? ''}`} {...rest} />;
}

/** Label + control stacked (design: report-incident form). */
export function FormField({
  label,
  children,
  span,
}: {
  label: string;
  children: ReactNode;
  span?: number;
}) {
  return (
    <label className={styles.formField} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {label}
      {children}
    </label>
  );
}

