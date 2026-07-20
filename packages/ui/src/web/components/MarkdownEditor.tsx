import { useEffect, useRef } from 'react';
import OverType, { type OverTypeInstance, type Theme } from 'overtype';

// цвета редактора из shadcn-переменных — тема всегда совпадает с приложением
const KDD_THEME: Theme = {
  name: 'kdd',
  colors: {
    bgPrimary: 'var(--color-background)',
    bgSecondary: 'var(--color-background)',
    text: 'var(--color-foreground)',
    cursor: 'var(--color-foreground)',
    placeholder: 'var(--color-muted-foreground)',
    h1: 'var(--color-foreground)',
    h2: 'var(--color-foreground)',
    h3: 'var(--color-foreground)',
    strong: 'var(--color-foreground)',
    em: 'var(--color-foreground)',
    link: 'var(--color-primary)',
    code: 'var(--color-foreground)',
    codeBg: 'var(--color-muted)',
    blockquote: 'var(--color-muted-foreground)',
    syntaxMarker: 'var(--color-muted-foreground)',
    listMarker: 'var(--color-muted-foreground)',
    hr: 'var(--color-border)',
    border: 'var(--color-border)',
  },
};

export function MarkdownEditor({
  value, onChange, placeholder, minHeight = '64px', maxHeight, autoFocus, onEnterSubmit, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** только px: overtype делает parseInt, rem/em молча превращаются в мусор */
  minHeight?: string;
  maxHeight?: string;
  autoFocus?: boolean;
  /** Enter отправляет, Shift+Enter — перенос строки */
  onEnterSubmit?: () => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<OverTypeInstance | null>(null);
  const cb = useRef({ onChange, onEnterSubmit });
  cb.current = { onChange, onEnterSubmit };

  useEffect(() => {
    const [ed] = new OverType(host.current!, {
      value,
      placeholder,
      autofocus: autoFocus,
      toolbar: false,
      autoResize: true,
      minHeight,
      maxHeight: maxHeight ?? null,
      smartLists: true,
      fontSize: '0.8125rem',
      theme: KDD_THEME,
      onChange: (v) => cb.current.onChange(v),
      onKeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey && cb.current.onEnterSubmit) {
          e.preventDefault();
          cb.current.onEnterSubmit();
        }
      },
    });
    editor.current = ed;
    return () => { ed.destroy(); editor.current = null; };
    // init один раз: value дальше синхронится эффектом ниже
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // внешний сброс (setComment('') после отправки и т.п.)
  useEffect(() => {
    const ed = editor.current;
    if (ed && ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  return <div ref={host} className={className} />;
}
