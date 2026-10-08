import { useEffect, useId, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { message, t } from '../lib/copy';
import { Button, Field, Notice } from './ui';

export type FormField = Readonly<{
  name: string;
  label: string;
  type?: ComponentProps<'input'>['type'];
  autoComplete?: string;
  hint?: string;
  defaultValue?: string;
  maxLength?: number;
}>;
type Validator<T> = Readonly<{
  safeParse: (value: unknown) =>
    | Readonly<{ success: true; data: T }>
    | Readonly<{
        success: false;
        error: Readonly<{
          issues: readonly Readonly<{
            path: readonly PropertyKey[];
            message: string;
          }>[];
        }>;
      }>;
}>;

function errorsFor<T>(
  validator: Validator<T>,
  form: HTMLFormElement,
): Record<string, string> {
  const result = validator.safeParse(Object.fromEntries(new FormData(form)));
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || errors[field]) continue;
    errors[field] =
      issue.message === 'PASSWORD_CONFIRMATION_MISMATCH' ||
      issue.message === 'PASSWORD_REQUIREMENTS_NOT_MET'
        ? message(new ApiError(issue.message))
        : t(
            field === 'email'
              ? 'invalidEmail'
              : field === 'name' || field === 'nickname'
                ? 'invalidNickname'
                : 'required',
          );
  }
  return errors;
}
export function DataForm<T>({
  fields,
  validator,
  submit,
  submitLabel,
  onSuccess,
  children,
  danger = false,
}: {
  fields: readonly FormField[];
  validator: Validator<T>;
  submit: (data: T, signal: AbortSignal) => Promise<void>;
  submitLabel: string;
  onSuccess?: (() => void) | undefined;
  children?: ReactNode;
  danger?: boolean;
}) {
  const prefix = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    const navigating = (event: Event) => {
      if (dirty.current && !window.confirm(t('unsaved')))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', leaving);
    window.addEventListener('rapidfire:before-navigation', navigating);
    return () => {
      request.current?.abort();
      window.removeEventListener('beforeunload', leaving);
      window.removeEventListener('rapidfire:before-navigation', navigating);
    };
  }, []);
  return (
    <form
      className="data-form"
      noValidate
      onChange={() => {
        dirty.current = true;
        setFailure(null);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        const parsed = validator.safeParse(
          Object.fromEntries(new FormData(form)),
        );
        if (!parsed.success) {
          setErrors(errorsFor(validator, form));
          setFailure(t('checkFields'));
          requestAnimationFrame(() => summary.current?.focus());
          return;
        }
        setErrors({});
        setFailure(null);
        setPending(true);
        const controller = new AbortController();
        request.current = controller;
        try {
          await submit(parsed.data, controller.signal);
          if (controller.signal.aborted) return;
          dirty.current = false;
          form.reset();
          onSuccess?.();
        } catch (error) {
          if (!controller.signal.aborted) {
            setFailure(message(error));
            requestAnimationFrame(() => summary.current?.focus());
          }
        } finally {
          if (!controller.signal.aborted) setPending(false);
        }
      }}
    >
      {failure ? (
        <div ref={summary} className="error-summary" tabIndex={-1} role="alert">
          <p>{failure}</p>
          {Object.entries(errors).length ? (
            <ul>
              {Object.entries(errors).map(([name, error]) => (
                <li key={name}>
                  <a
                    href={`#${prefix}-${name}`}
                    onClick={() =>
                      document.getElementById(`${prefix}-${name}`)?.focus()
                    }
                  >
                    {error}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={pending} className="form-fields">
        {fields.map((field) => (
          <Field
            key={field.name}
            {...field}
            id={`${prefix}-${field.name}`}
            type={field.type ?? 'text'}
            required
            spellCheck={false}
            error={errors[field.name] ?? ''}
            onBlur={(event) => {
              const form = event.currentTarget.form;
              if (form) {
                const next = errorsFor(validator, form);
                const error = next[field.name];
                setErrors((current) => {
                  const copy = { ...current };
                  if (error) copy[field.name] = error;
                  else delete copy[field.name];
                  return copy;
                });
              }
            }}
          />
        ))}
      </fieldset>
      {children}
      <Button
        variant={danger ? 'danger' : 'primary'}
        type="submit"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? t('working') : submitLabel}
      </Button>
      {pending ? <Notice>{t('working')}</Notice> : null}
    </form>
  );
}
