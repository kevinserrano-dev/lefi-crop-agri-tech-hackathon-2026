import { useId, type InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function TextField({ label, id, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className={styles.field} htmlFor={inputId}>
      <span>{label}</span>
      <input id={inputId} className={styles.input} {...rest} />
    </label>
  );
}
