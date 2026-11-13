import { axisLabels, healthyShare, scaleOf, timeTicks } from './dashboardModel';

describe('Dashboard derivations (ADR-077)', () => {
  it('scales a chart around real values only and draws nothing without them', () => {
    expect(scaleOf([null, null])).toBeNull();
    expect(scaleOf([20, null, 24])).toEqual({ min: 19, max: 25 });
    // A flat line still gets a visible scale.
    expect(scaleOf([21, 21])).toEqual({ min: 19, max: 23 });
    expect(axisLabels({ min: 0, max: 90 }, '°')).toEqual(['90°', '60°', '30°', '0°']);
  });

  it('counts healthy plants among those people checked; a day with none is a gap', () => {
    const share = healthyShare({
      days: ['a', 'b'],
      healthy: [3, 0],
      watch: [1, 0],
      problem: [0, 0],
      not_checked: [5, 9],
    });
    expect(share[0]).toBe(75);
    expect(Number.isNaN(share[1])).toBe(true);
  });

  it('labels the axis from the window Lefi Brain sent', () => {
    const iso = (d: Date) => d.toISOString().slice(11, 16);
    expect(timeTicks('2026-11-10T00:00:00Z', 1800, 48, iso)).toEqual([
      '00:00',
      '06:00',
      '12:00',
      '18:00',
      '00:00',
    ]);
  });
});
