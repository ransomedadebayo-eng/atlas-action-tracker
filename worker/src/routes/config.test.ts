import { describe, expect, it } from 'vitest';
import { hydrateEstimateSettings, validateEstimateSettings } from './config';

describe('estimate settings', () => {
  it('hydrates a Fibonacci scale with zero and extended values', () => {
    expect(hydrateEstimateSettings({ enabled: true, scale: 'fibonacci', extended: true, allow_zero: true, unestimated_value: 1 }).options)
      .toEqual([
        { value: 0, label: '0' }, { value: 1, label: '1' }, { value: 2, label: '2' },
        { value: 3, label: '3' }, { value: 5, label: '5' }, { value: 8, label: '8' },
        { value: 13, label: '13' }, { value: 21, label: '21' },
      ]);
  });

  it('hydrates T-shirt labels while retaining numeric effort values', () => {
    expect(hydrateEstimateSettings({ enabled: true, scale: 'tshirt', extended: false, allow_zero: false, unestimated_value: 1 }).options)
      .toEqual([
        { value: 1, label: 'XS' }, { value: 2, label: 'S' }, { value: 3, label: 'M' },
        { value: 5, label: 'L' }, { value: 8, label: 'XL' },
      ]);
  });

  it('rejects malformed settings', () => {
    expect(validateEstimateSettings({ enabled: 'yes', scale: 'custom', extended: false, allow_zero: true, unestimated_value: -1 })).toEqual(expect.arrayContaining([
      'enabled must be boolean',
      'scale must be linear, fibonacci, exponential, or tshirt',
      'unestimated_value must be a non-negative integer up to 1000',
    ]));
  });
});
