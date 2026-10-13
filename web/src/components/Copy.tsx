import { useEffect, useState } from 'preact/hooks';

export function CopyButton({ text, label = 'Copy', small = true }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      class={`btn ${small ? 'sm' : ''} ${done ? 'copied' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          // clipboard blocked; fall back to selection
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          setDone(true);
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}
