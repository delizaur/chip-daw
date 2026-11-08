import type { ParamDescriptor } from '../../model/boxes/types';

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/** Display text for a box parameter value, based on its descriptor. */
export function formatParam(param: ParamDescriptor, value: number): string {
  if (param.steps) {
    return param.steps[Math.round((value - param.min) / (param.step ?? 1))] ?? String(value);
  }
  switch (param.unit) {
    case 's':
      return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
    case '%':
      return `${Math.round(value * 100)}%`;
    case 'st':
      return `${signed(Math.round(value))} st`;
    case 'ct':
      return `${signed(Math.round(value))} ct`;
    case 'Hz':
      return value >= 1000
        ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`
        : `${Math.round(value)} Hz`;
    default:
      return param.step && Number.isInteger(param.step)
        ? String(Math.round(value))
        : value.toFixed(2);
  }
}
