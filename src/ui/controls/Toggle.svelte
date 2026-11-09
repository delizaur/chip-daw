<!--
  On/off button. Lights up in `color` when pressed. Content comes from children (text or icon).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    pressed: boolean;
    /** Accessible name; also shown as a tooltip unless `title` is given. */
    label: string;
    /** Tooltip, e.g. with a keyboard shortcut. */
    title?: string;
    color?: string;
    size?: 'small' | 'medium';
    disabled?: boolean;
    onchange: (pressed: boolean) => void;
    children: Snippet;
  }

  let {
    pressed,
    label,
    title,
    color = 'var(--accent)',
    size = 'medium',
    disabled = false,
    onchange,
    children,
  }: Props = $props();
</script>

<button
  type="button"
  class="toggle {size}"
  class:pressed
  style:--color={color}
  aria-pressed={pressed}
  aria-label={label}
  title={title ?? label}
  {disabled}
  onclick={() => onchange(!pressed)}
>
  {@render children()}
</button>

<style>
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    border-radius: var(--r-s);
    background: var(--panel-raised);
    box-shadow: var(--shadow-raised);
    font-weight: 700;
    color: var(--ink-dim);
    transition:
      background 80ms,
      color 80ms;
  }

  .medium {
    min-width: var(--hit);
    height: var(--hit);
    padding: 0 var(--space-3);
    font-size: var(--text-s);
  }

  /* Visually compact, but the hit area still reaches the touch minimum. */
  .small {
    position: relative;
    min-width: 26px;
    height: 26px;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .small::after {
    content: '';
    position: absolute;
    inset: -7px -4px;
  }

  .pressed {
    background: var(--color);
    color: var(--ink-on-color);
  }

  .toggle:disabled {
    opacity: 0.4;
  }
</style>
