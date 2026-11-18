<!--
  Pick one of a few options (waveforms, modes...). Arrow keys move the selection.
-->
<script lang="ts" generics="T extends string | number">
  interface Option {
    value: T;
    label: string;
    /** An SVG path in a 24×12 box, shown instead of the label (which stays the name). */
    icon?: string;
  }

  interface Props {
    value: T;
    options: Option[];
    /** Accessible name for the group. */
    label: string;
    color?: string;
    /** Small: shorter buttons, for packed panels (still a comfortable click target). */
    size?: 'small' | 'medium';
    disabled?: boolean;
    onchange: (value: T) => void;
  }

  let {
    value,
    options,
    label,
    color = 'var(--accent)',
    size = 'medium',
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
  class="segmented {size}"
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
      class:icon={option.icon}
      aria-label={option.icon ? option.label : undefined}
      title={option.icon ? option.label : undefined}
      onclick={() => onchange(option.value)}
    >
      {#if option.icon}
        <svg viewBox="0 0 24 12" width="24" height="12" aria-hidden="true"
          ><path d={option.icon} /></svg
        >
      {:else}
        {option.label}
      {/if}
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
    border-radius: var(--r-s);
    font-size: var(--text-s);
    font-weight: 500;
    white-space: nowrap;
    color: var(--ink-dim);
  }

  button.icon {
    min-width: 34px;
    padding: 0 var(--space-2);
  }

  button[aria-checked='true'] {
    background: var(--color);
    color: var(--ink-on-color);
  }

  svg {
    display: block;
    margin: auto;
    overflow: visible;
  }

  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  .small button {
    height: 26px;
  }

  button:disabled {
    opacity: 0.4;
  }
</style>
