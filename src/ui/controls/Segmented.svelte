<!--
  Pick one of a few options (waveforms, modes...). Arrow keys move the selection.
-->
<script lang="ts" generics="T extends string | number">
  interface Option {
    value: T;
    label: string;
  }

  interface Props {
    value: T;
    options: Option[];
    /** Accessible name for the group. */
    label: string;
    color?: string;
    disabled?: boolean;
    onchange: (value: T) => void;
  }

  let {
    value,
    options,
    label,
    color = 'var(--accent)',
    disabled = false,
    onchange,
  }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  function onkeydown(event: KeyboardEvent) {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!delta || disabled) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = (index + delta + options.length) % options.length;
    onchange(options[next]!.value);
    buttons[next]?.focus();
  }
</script>

<div
  class="segmented"
  role="radiogroup"
  aria-label={label}
  aria-disabled={disabled}
  style:--color={color}
  tabindex="-1"
  {onkeydown}
>
  {#each options as option, i (option.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={option.value === value}
      tabindex={option.value === value ? 0 : -1}
      {disabled}
      onclick={() => onchange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    padding: 3px;
    gap: 3px;
    border-radius: var(--r-m);
    background: var(--panel-sunken);
  }

  button {
    min-width: var(--hit);
    height: calc(var(--hit) - 6px);
    padding: 0 var(--space-3);
    border-radius: calc(var(--r-m) - 3px);
    font-size: var(--text-s);
    font-weight: 600;
    color: var(--ink-dim);
  }

  button[aria-checked='true'] {
    background: var(--color);
    color: var(--ink-on-color);
  }

  button:disabled {
    opacity: 0.4;
  }
</style>
