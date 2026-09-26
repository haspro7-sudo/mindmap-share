// Small building blocks shared by the 設定 sections (styles in ../Settings.css).
import { useId } from 'react';
import type { ReactNode } from 'react';

export interface SettingsSectionProps {
  /** DOM id (the section nav scrolls to it) */
  id: string;
  title: string;
  icon?: string;
  lead?: string;
  children: ReactNode;
}

export function SettingsSection({ id, title, icon, lead, children }: SettingsSectionProps): ReactNode {
  return (
    <section id={id} className="card set-sec" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="set-h2" tabIndex={-1}>
        {icon ? (
          <span className="set-h2-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span>{title}</span>
      </h2>
      {lead ? <p className="set-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

export interface SwitchRowProps {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

/** A whole-row tappable switch (native checkbox with role="switch"); the description is aria-describedby. */
export function SwitchRow({ title, description, checked, disabled, onChange }: SwitchRowProps): ReactNode {
  const id = useId();
  return (
    <label className="set-switch" htmlFor={`${id}-input`}>
      <span className="set-switch-text">
        <span id={`${id}-title`} className="set-switch-title">
          {title}
        </span>
        <span id={`${id}-desc`} className="set-switch-desc">
          {description}
        </span>
      </span>
      <input
        id={`${id}-input`}
        type="checkbox"
        role="switch"
        className="set-switch-input"
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** A full-width navigation row (link) with a chevron. */
export function LinkRow({ href, title, description, icon }: { href: string; title: string; description?: string; icon?: string }): ReactNode {
  return (
    <a className="set-link" href={href}>
      {icon ? (
        <span className="set-link-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="set-link-text">
        <span className="set-link-title">{title}</span>
        {description ? <span className="set-link-desc">{description}</span> : null}
      </span>
      <span className="set-link-chev" aria-hidden="true">
        ›
      </span>
    </a>
  );
}
