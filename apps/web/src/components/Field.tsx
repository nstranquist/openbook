import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`g-field ob-field${className ? ` ${className}` : ""}`}>
      <span className="g-label">{label}</span>
      {children}
      {hint ? <span className="g-hint">{hint}</span> : null}
      {error ? <span className="g-error-text" role="alert">{error}</span> : null}
    </label>
  );
}
